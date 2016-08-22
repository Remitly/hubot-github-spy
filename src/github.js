
"use strict";
const Events = require("./events");

//
// Helpers
//

const SECONDS_PER_WEEK = 60 * 60 * 24 * 7;

function formatNewLines(obj) {
    for (const key in obj) {
        const value = obj[key];
        if (typeof value === "string" || value instanceof String) {
            obj[key] = value.replace(/\r\n/g, "\n");
        } else {
            formatNewLines(value);
        }
    }
    return obj;
}

//
// Github
//

class Github {
    constructor(robot, redis) {
        this._robot = robot;
        this._redis = redis;
    }

    // Logins

    setLoginForUser(user, login) {
        // we drop down into lua here, as it's the only way to atomically get a
        // value and use it to act on another value
        if (!this._redis.setLoginForUser) {
            this._redis.defineCommand("setLoginForUser", {
                numberOfKeys: 0,
                lua: `
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
                `
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
        // // commits
        // case "push":
        //     this._handleCommit(data.action, data);
        //     break;
        // case "commit_comment":
        //     this._handleCommitComment("commented", data);
        //     break;

        // issues
        case "issue":
            this._handleIssue(data.action, data);
            break;
        case "issue_comment":
            this._handleIssue("commented", data);
            break;

        // pull requests
        case "pull_request":
            this._handleIssue(data.action, data);
            break;
        case "pull_request_review_comment":
            this._handleIssue("commented", data);
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

    _addWatcher(type, user, name) {
        name = name.toLowerCase();
        const typeKey = this._typeKey(type, name);
        const userKey = this._userKey(type, user);

        return this._redis
            .multi()
            .sadd(typeKey, user.id)
            .sadd(userKey, name)
            .exec();
    }

    _getWatched(type, user, callback) {
        const userKey = this._userKey(type, user);
        this._redis.smembers(userKey, (err, watched) => callback(watched));
    }

    _removeWatcher(type, user, name) {
        name = name.toLowerCase();
        const typeKey = this._typeKey(type, name);
        const userKey = this._userKey(type, user);

        return this._redis
            .multi()
            .srem(typeKey, user.id)
            .srem(userKey, name)
            .exec();
    }

    // Issues

    _handleIssue(action, data) {
        // create the event itself
        const event           = Events.create(action, data);
        const participantsKey = `participants:${event.id}`;

        // first we'll add all the participants
        const command = this._redis
            .pipeline()
            .sadd(participantsKey, event.participants, event.mentions)
            // TODO: we expire participants after a week, so stale issues don't
            // stick around forever.  what we don't do, currently, is re-sync all
            // participants if we get an event for an expired issue.
            .expire(participantsKey, SECONDS_PER_WEEK);

        // if we don't have any details, that's all we're doing
        if (!event.details) {
            command.exec();
            return;
        }

        // if we do have details, we need to get the right set of watchers
        const watchersKeys = [`issue:${event.id}`];

        // most of the time, we only care about the issue watchers.  in the
        // "opened" case, however, we also won't to notify the repo watchers.
        if (action === "opened") {
            watchersKeys.push(`repo:${event.repoId}`);
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

                this._notify(results[2][1], results[3][1], event);
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
                watchers.forEach((userId) => {
                    if (userId !== results[1][1]) {
                        const user = this._robot.brain.userForId(userId);

                        // TODO: handle generic sends if we're not connected to slack
                        //  this._robot.send(user, details.fallback)

                        this._robot.emit("slack-attachment", {
                            channel:     user.name,
                            attachments: [details]
                        });
                    } else {
                        this._robot.logger.info(`Skipping ${event.sender}: ${details.fallback}`);
                    }
                });
            });
    }
}

module.exports = Github;
