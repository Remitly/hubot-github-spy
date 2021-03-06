
const Events = require("./events");

//
// Helpers
//

const ONE_DAY  = 60 * 60 * 24;
const ONE_WEEK = ONE_DAY * 7;

function formatNewLines(obj) {
    if (obj == null) return obj;
    const ref = obj;

    Object.keys(ref).forEach((key) => {
        const value = ref[key];
        if (typeof value === "string" || value instanceof String) {
            ref[key] = value.replace(/\r\n/g, "\n");
        } else {
            formatNewLines(value);
        }
    });

    return ref;
}

//
// Github
//

const DEFAULT_EXPIRATION = ONE_WEEK * 4;

module.exports = class Github {
    constructor(robot, redis) {
        this._robot = robot;
        this._redis = redis;
        this._reviewCommentIds = [];
    }

    // Logins

    setLoginForUser(user, login) {
        // we drop down into lua here, as it's the only way to atomically get a
        // value and use it to act on another value
        if (!this._redis.setLoginForUser) {
            this._redis.defineCommand("setLoginForUser", {
                numberOfKeys: 0,
                lua:          `
                    local userId = ARGV[1]
                    local login  = ARGV[2]

                    if login ~= "" then
                        local loginId = login:lower()
                        local oldId   = redis.call("hget", "logins", loginId)

                        redis.call("hdel", "users",  oldId)
                        redis.call("hset", "logins", loginId, userId)
                        redis.call("hset", "users",  userId,  login)
                    else
                        local login   = redis.call("hget", "users", userId)
                        local loginId = login:lower()

                        redis.call("hdel", "users",  userId)
                        redis.call("hdel", "logins", loginId)
                    end
                `,
            });
        }

        this._redis.setLoginForUser(user.id, login);
    }

    loginForUser(user, callback) {
        this._redis.hget("users", user.id, (err, login) => callback(login));
    }

    // Repos

    addWatcherForRepo(user, repo) {
        return this._addWatcher("repo", user, repo);
    }

    reposForUser(user, callback) {
        this._getWatched("repo", user, callback);
    }

    removeWatcherForRepo(user, repo) {
        return this._removeWatcher("repo", user, repo);
    }

    // Issues

    addWatcherForIssue(user, issue) {
        return this._addWatcher("issue", user, issue);
    }

    issuesForUser(user, callback) {
        this._getWatched("issue", user, callback);
    }

    removeWatcherForIssue(user, issue) {
        return this._removeWatcher("issue", user, issue);
    }

    // Events

    handle(event, data) {
        switch (event) {
        // commits
        case "push":
            this._handlePush(event, data);
            break;
        case "commit_comment":
            this._handleCommitComment(event, data);
            break;

        // issues and pull requests
        case "issues":
        case "issue_comment":
        case "pull_request":
        case "pull_request_review":
        case "pull_request_review_comment":
            this._handleIssue(event, data);
            break;

        default:
            break;
        }
    }

    //
    // Private
    //

    // Watchers

    _typeKey(type, name) {
        return `${type}:${name}`;
    }

    _userKey(type, user) {
        return `user:${user.id}:${type}`;
    }

    _participantsKey(name) {
        return `participants:${name}`;
    }

    _addWatcher(type, user, name) {
        const canonicalName = name.toLowerCase();
        const typeKey = this._typeKey(type, canonicalName);
        const userKey = this._userKey(type, user);

        return this._redis
            .multi()
            .sadd(typeKey, user.id)
            .sadd(userKey, canonicalName)
            .exec();
    }

    _getWatched(type, user, callback) {
        const userKey = this._userKey(type, user);
        this._redis.smembers(userKey, (err, watched) => callback(watched));
    }

    _removeWatcher(type, user, name) {
        const canonicalName = name.toLowerCase();
        const typeKey = this._typeKey(type, canonicalName);
        const userKey = this._userKey(type, user);

        // if the type is an issue, also remove the user as a participant
        if (type === "issue") {
            this.loginForUser(user, (login) => {
                if (!login) {
                    return;
                }

                const participantsKey = this._participantsKey(canonicalName);
                this._redis.srem(participantsKey, login);
            });
        }

        return this._redis
            .multi()
            .srem(typeKey, user.id)
            .srem(userKey, canonicalName)
            .exec();
    }

    // Commits

    _handlePush(action, data) {
        // create the event itself
        const event = Events.create(action, data);

        // watch the participants (read: authors) and store the title
        // for every commit
        const command = this._redis.pipeline();

        for (const commit of event.commits) {
            const participantsKey = `participants:${commit.id}`;
            const titleKey        = `title:${commit.id}`;

            command
                .sadd(participantsKey, commit.author)
                .expire(participantsKey, DEFAULT_EXPIRATION)
                .set(titleKey, commit.title, "EX", DEFAULT_EXPIRATION);
        }

        command.exec();
    }

    _handleCommitComment(action, data) {
        // create the event itself
        const event    = Events.create(action, data);
        const titleKey = `title:${event.id}`;

        // first we'll grab the title
        this._redis.multi()
            .get(titleKey)
            .expire(titleKey, DEFAULT_EXPIRATION)
            .exec((err, results) => {
                const title = results[0][1];

                // re-build the data with the title in it
                const merged = Object.assign({}, data, {
                    comment: Object.assign({}, data.comment, {
                        title,
                    }),
                });

                // re-create the event and process it
                const updatedEvent = Events.create(action, merged);
                this._processEvent(action, updatedEvent);
            });
    }

    // Issues

    _handleIssue(raw, data) {
        // create the event itself and process it
        const event = Events.create(raw, data);
        this._processEvent(data.action, event);
    }

    // Event Processing

    _processEvent(action, event) {
        // first we'll add all the participants
        const participantsKey = `participants:${event.id}`;

        const command = this._redis
            .pipeline()
            .sadd(participantsKey, [...event.participants], [...event.mentions])
            // TODO: we expire participants after four weeks, so stale issues don't
            // stick around forever.  what we don't do, currently, is re-sync all
            // participants if we get an event for an expired issue.
            .expire(participantsKey, DEFAULT_EXPIRATION);

        // if we don't have any details, that's all we're doing
        if (!event.details) {
            command.exec();
            return;
        }

        // if this event has a comment and is for a pull request review, track it
        if (event.comment && event.comment.pull_request_review_id) {
            this._reviewCommentIds.push(event.comment.pull_request_review_id);

            // but only track the last 100
            if (this._reviewCommentIds.length > 100) {
                this._reviewCommentIds.shift();
            }
        }

        // if we do have details, we need to get the right set of watchers
        const watchersKeys = [`issue:${event.id}`];

        // most of the time, we only care about the issue watchers.  in the
        // "opened" case, however, we also want to notify the repo watchers.
        if (action === "opened") {
            watchersKeys.push(`repo:${event.repoId}`);
        }

        if (event.reviewer) {
            this._notify([], [event.reviewer], event);
            return;
        }

        // finally we'll get all the participants and execute
        command
            .sunion(watchersKeys)
            .smembers(participantsKey)
            .exec((err, results) => {
                // TODO: remove this once things stabilize
                if (err) {
                    this._robot.logger.error(err);
                    return;
                }

                // due to a github bug, we will sometimes receive a `pull_request_review` event
                // for a comment without a subsequent `pull_request_review_comment`.  in the
                // case that we receive both, we don't need to notify the user of both.  in the
                // case that we don't, we should at least let them know something happened, even
                // if we don't have the details.  we wait for one second to check whether or not
                // we've received the comment itself before notifying about the review event.
                const notify = () => this._notify(results[2][1], results[3][1], event);

                if (event.review && event.isComment) {
                    setTimeout(() => {
                        // only notify of the review event if we didn't notify on
                        // the paired comment event (because we didn't receive it).
                        if (!this._reviewCommentIds.includes(event.review.id)) {
                            notify();
                        }
                    }, 1000);
                } else {
                    notify();
                }
            });
    }

    _notify(watchersArray, participants, event) {
        // make sure our messages will be formatted correctly
        const details = formatNewLines(event.details);
        details.mrkdwn_in = ["pretext", "text", "fields"];

        // add the participants to the watchers
        const watchers = new Set(watchersArray);
        const senderId = event.sender.toLowerCase();

        this._redis
            .multi()
            .hmget("logins", participants.map(login => login.toLowerCase()))
            .hget("logins", senderId)
            .exec((err, results) => {
                // TODO: remove this once things stabilize
                if (err) {
                    this._robot.logger.error(err);
                    return;
                }

                for (const userId of results[0][1]) {
                    if (userId) {
                        watchers.add(userId);
                    }
                }

                // notify all the watchers, except the sender
                if (watchers.size === 0) return;

                const isSlack = (this._robot.adapterName === "slack");
                const payload = isSlack
                    ? {
                        attachments: [details],
                    }
                    : details.fallback;

                const log = [JSON.stringify(payload, null, "  ")];
                watchers.forEach((userId) => {
                    const user = isSlack
                        ? this._robot.adapter.client.rtm.dataStore.getUserById(userId)
                        : this._robot.brain.userForId(userId);
                    const name = (user && user.name) ? user.name : userId;

                    if (userId !== results[1][1]) {
                        this._robot.messageRoom(userId, payload);
                        log.push(`- Sent to ${name}`);
                    } else {
                        log.push(`- Skipped ${name}`);
                    }
                });

                this._robot.logger.info(log.join("\n"));
            });
    }
};
