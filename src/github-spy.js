// Description:
//   Notifies users of relevant GitHub repo updates
//
// Commands:
//   hubot alias <username> - Registers your github username.
//   hubot alias[?] - Lists your registered github username.
//   hubot unalias - Unregisters your github username with.
//   hubot watch <user/repository> - Watches a github repository for updates.
//   hubot repos[?] - Lists the github repositories you're watching.
//   hubot unwatch <user/repository> - Stops watching a github repository.
//   hubot watch <user/repository#number> - Watches a github issue for updates.
//   hubot issues[?] - Lists the github issues you're watching.
//   hubot unwatch <user/repository#number> - Stops watching a github issue.
//
// Author:
//   jaredru
"use strict";

const Redis = require("ioredis");

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
// Github Events
//

class IssueEvent {
    static create(action, data) {
        // pull requests are just a specialized type of issue
        const type = data.pull_request || (data.issue && data.issue.pull_request) ? PullRequestEvent : IssueEvent;

        // get some of the basic issue info
        const repo = data.repository;
        const info = data.pull_request || data.issue;

        // create and return the event type
        return new type(repo, info, action, data);
    }

    constructor(repo, info, action, data) {
        this.repo   = repo;
        this.info   = info;
        this.action = action;
        this.data   = data;
        this.repoId = this.repo.full_name.toLowerCase();

        this.id           = `${this.repoId}#${this.info.number}`;
        this.sender       = this.data.sender.login;
        this.participants = [this.repo.owner.login, this.info.user.login, this.sender];

        this._buildDetails();
    }

    //
    // Private
    //

    _buildDetails() {
        switch (this.action) {
        case "opened":
            this._opened();
            break;
        case "reopened":
            this._reopened();
            break;
        case "assigned":
            this._assigned();
            break;
        case "unassigned":
            this._unassigned();
            break;
        case "commented":
            this._commented();
            break;
        case "closed":
            this._closed();
            break;
        }
    }

    _pretext() {
        return `[<${this.repo.html_url}|${this.repo.full_name}>] Issue <${this.info.html_url}|#${this.info.number}: ${this.info.title}>`;
    }

    _setDetails(details) {
        details.pretext  = this._pretext();
        details.fallback = `${details.pretext}\n> ${details.title}`;

        if (details.text) {
            details.fallback += `\n> ${details.text}`;
        }

        this.details = details;
    }

    // TODO: map the github names to chat names if possible?
    _opened() {
        this._setDetails({
            title: `Opened by ${this.sender}`,
            text:  this.info.body
        });
    }

    _reopened() {
        this._setDetails({
            title: `Reopened by ${this.sender}`
        });
    }

    _assigned() {
        this.assignee = this.data.assignee.login;
        this.participants.push(this.assignee);

        this._setDetails({
            title: `Assigned to ${this.assignee} by ${this.sender}`
        });
    }

    _unassigned() {
        this.assignee = this.data.assignee.login;
        this.participants.push(this.assignee);

        this._setDetails({
            title: `Unassigned from ${this.assignee} by ${this.sender}`
        });
    }

    _commented() {
        this.comment = this.data.comment;

        this._setDetails({
            title:      `Comment by ${this.sender}`,
            title_link: this.comment.html_url,
            text:       this.comment.body
        });
    }

    _closed() {
        this._setDetails({
            title: `Closed by ${this.sender}`
        });
    }
}

class PullRequestEvent extends IssueEvent {
    //
    // Private
    //

    _buildDetails() {
        switch (this.action) {
        case "synchronize":
            this._synchronized();
            break;
        default:
            super._buildDetails(arguments);
            break;
        }
    }

    _pretext() {
        return `[<${this.repo.html_url}|${this.repo.full_name}>] Pull Request <${this.info.html_url}|#${this.info.number}: ${this.info.title}>`;
    }

    _synchronized() {
        this._setDetails({
            title: `Commits added by ${this.sender}`
        });
    }

    _closed() {
        const closeAction = this.info.merged ? "Merged" : "Closed";

        this._setDetails({
            title: `${closeAction} by ${this.sender}`
        });
    }
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
        const event           = IssueEvent.create(action, data);
        const participantsKey = `participants:${event.id}`;

        // first we'll add all the participants
        const command = this._redis
            .pipeline()
            .sadd(participantsKey, event.participants)
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
            .hmget("logins", participants)
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

//
// Hubot
//

const REDIS_URL = process.env.HUBOT_GITHUB_SPY_REDIS_URL;

module.exports = function(robot) {
    const redis  = new Redis(REDIS_URL);
    const github = new Github(robot, redis);

    //
    // Debug
    //

    robot.on("slack-attachment", (data) => {
        robot.logger.info("slack-attachment:", JSON.stringify(data));
    });

    robot.respond(/test-attach\s+(.*)$/i, (res) => {
        const data = formatNewLines(JSON.parse(res.match[1]));
        data.mrkdwn_in = ["pretext", "text", "fields"];

        robot.emit("slack-attachment", {
            channel:     res.message.user.name,
            attachments: data
        });
    });

    //
    // Logins
    //

    robot.respond(/alias\s+([\w-]+)\s*$/i, (res) => {
        const user  = res.message.user;
        const alias = res.match[1];

        github.setLoginForUser(user, alias);
        res.reply(`Your GitHub alias is set to ${alias}.`);
    });

    robot.respond(/alias\??$/i, (res) => {
        const user = res.message.user;

        github.loginForUser(user, (alias) => {
            if (alias) {
                res.reply(`Your GitHub alias is set to ${alias}.`);
            } else {
                res.reply("You haven't set a GitHub alias.");
            }
        });
    });

    robot.respond(/unalias\s*$/i, (res) => {
        const user = res.message.user;

        github.loginForUser(user, (alias) => {
            if (alias) {
                github.setLoginForUser(user);
                res.reply("Your GitHub alias has been removed.");
            } else {
                res.reply("You haven't set a GitHub alias.");
            }
        });
    });

    // Repos

    robot.respond(/watch ([\w-]+\/[\w-]+)\s*$/i, (res) => {
        const user = res.message.user;
        const repo = res.match[1];

        github.addWatcherForRepo(user, repo);
        res.reply(`You are now watching the GitHub repo ${repo}.`);
    });

    robot.respond(/repos?\??\s*$/i, (res) => {
        _listReposForUser(res);
    });

    robot.respond(/unwatch ([\w-]+\/[\w-]+)\s*$/i, (res) => {
        const user = res.message.user;
        const repo = res.match[1];

        if (github.removeWatcherForRepo(user, repo)) {
            res.reply(`You are no longer watching the GitHub repo ${repo}.`);
        } else {
            res.reply(`You are not watching the GitHub repo ${repo}.`);
        }
    });

    // Issues/PRs

    robot.respond(/watch ([\w-]+\/[\w-]+#\d+)\s*$/i, (res) => {
        const user  = res.message.user;
        const issue = res.match[1];

        github.addWatcherForIssue(user, issue);
        res.reply(`You are now watching the GitHub issue ${issue}.`);
    });

    robot.respond(/issues?\??\s*$/i, (res) => {
        _listIssuesForUser(res);
    });

    robot.respond(/unwatch ([\w-]+\/[\w-]+#\d+)\s*$/i, (res) => {
        const user  = res.message.user;
        const issue = res.match[1];

        if (github.removeWatcherForIssue(user, issue)) {
            res.reply(`You are no longer watching the GitHub issue ${issue}.`);
        } else {
            res.reply(`You are not watching the GitHub issue ${issue}.`);
        }
    });

    // Incoming

    robot.router.post("/github-spy", (req, res) => {
        const event = req.headers["x-github-event"];
        const body  = req.body;

        github.handle(event, body);
        res.send("OK");
    });

    function _listReposForUser(res) {
        github.reposForUser(res.message.user, (repos) => {
            _listItemsForUser("repos", repos, res);
        });
    }

    function _listIssuesForUser(res) {
        github.issuesForUser(res.message.user, (issues) => {
            _listItemsForUser("issues", issues, res);
        });
    }

    function _listItemsForUser(type, items, res) {
        if (items.length) {
            items = items
                .sort()
                .map(item => `  - ${item}`)
                .join("\n");

            res.reply(`You are watching the GitHub ${type}:\n${items}`);
        } else {
            res.reply(`You are not watching any GitHub ${type}.`);
        }
    }
}

