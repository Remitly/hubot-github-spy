# Description:
#   Notifies users of relevant GitHub repo updates
#
# Commands:
#   hubot alias <username> - Registers your github username.
#   hubot alias[?] - Lists your registered github username.
#   hubot unalias - Unregisters your github username with.
#   hubot watch <user/repository> - Watches a github repository for updates.
#   hubot repos[?] - Lists the github repositories you're watching.
#   hubot unwatch <user/repository> - Stops watching a github repository.
#   hubot watch <user/repository#number> - Watches a github issue for updates.
#   hubot issues[?] - Lists the github issues you're watching.
#   hubot unwatch <user/repository#number> - Stops watching a github issue.
#
# Author:
#   jaredru

Redis = require("ioredis")

SECONDS_PER_WEEK = 60 * 60 * 24 * 7

formatNewLines = (obj) ->
    for key, value of obj
        if typeof value is "string" || value instanceof String
            obj[key] = value.replace /\r\n/g, "\n"
        else
            formatNewLines(value)
    return obj

#
# Github Events
#

class IssueEvent

    # Static

    @create: (action, data) ->
        # pull requests are just a specialized type of issue
        type = \
            if data.pull_request or data.issue?.pull_request
                PullRequestEvent
            else
                IssueEvent

        # get some of the basic issue info
        repo = data.repository
        info = data.pull_request or data.issue

        # create and return the event type
        new type(repo, info, action, data)

    # Instance

    constructor: (@repo, @info, @action, @data) ->
        @repoId = @repo.full_name.toLowerCase()
        @id     = "#{@repoId}##{@info.number}"

        @sender       = @data.sender.login
        @participants = [ @repo.owner.login, @info.user.login, @sender ]

        @_buildDetails()

    #
    # Private
    #

    _buildDetails: ->
        handler = switch @action
            when "opened"     then @_opened
            when "reopened"   then @_reopened
            when "assigned"   then @_assigned
            when "unassigned" then @_unassigned
            when "commented"  then @_commented
            when "closed"     then @_closed
        handler?.call(@)

    _pretext: ->
        "[<#{@repo.html_url}|#{@repo.full_name}>] Issue <#{@info.html_url}|##{@info.number}: #{@info.title}>"

    _setDetails: (details) ->
        details.pretext  = @_pretext()
        details.fallback = "#{details.pretext}\n> #{details.title}"

        if details.text
            details.fallback += "\n> #{details.text}"

        @details = details

    # TODO: map the github names to chat names if possible?
    _opened: ->
        @_setDetails(
            title: "Opened by #{@sender}",
            text:  @info.body
        )

    _reopened: ->
        @_setDetails(
            title: "Reopened by #{@sender}"
        )

    _assigned: ->
        @assignee = @data.assignee.login
        @participants.push(@assignee)

        @_setDetails(
            title: "Assigned to #{@assignee} by #{@sender}"
        )

    _unassigned: ->
        @assignee = @data.assignee.login
        @participants.push(@assignee)

        @_setDetails(
            title: "Unassigned from #{@assignee} by #{@sender}"
        )

    _commented: ->
        @comment = @data.comment

        @_setDetails(
            title:      "Comment by #{@sender}",
            title_link: @comment.html_url
            text:       @comment.body
        )

    _closed: ->
        @_setDetails(
            title: "Closed by #{@sender}"
        )

class PullRequestEvent extends IssueEvent
    #
    # Private
    #

    _buildDetails: ->
        handler = switch @action
            when "synchronize" then @_synchronized

        if handler
            handler.call(@)
        else
            super

    _pretext: ->
        "[<#{@repo.html_url}|#{@repo.full_name}>] Pull Request <#{@info.html_url}|##{@info.number}: #{@info.title}>"

    _synchronized: ->
        @_setDetails(
            title: "Commits added by #{@sender}"
        )

    _closed: ->
        closeAction = if @info.merged then "Merged" else "Closed"

        @_setDetails(
            title: "#{closeAction} by #{@sender}"
        )

#
# Github
#

class Github
    constructor: (robot, redis) ->
        @_robot = robot
        @_redis = redis

    # Logins

    setLoginForUser: (user, login) ->
        # we drop down into lua here, as it's the only way to atomically get a
        # value and use it to act on another value
        unless @_redis.setLoginForUser
            @_redis.defineCommand("setLoginForUser",
                numberOfKeys: 0,
                lua: """
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
                """
            )
        @_redis.setLoginForUser(user.id, login)

    loginForUser: (user, callback) ->
        @_redis.hget("users", user.id, (err, login) ->
            callback(login)
        )

    # Repos

    addWatcherForRepo: (user, repo) ->
        @_addWatcher("repo", user, repo)

    reposForUser: (user, callback) ->
        @_getWatched("repo", user, callback)

    removeWatcherForRepo: (user, repo) ->
        @_removeWatcher("repo", user, repo)

    # Issues

    addWatcherForIssue: (user, issue) ->
        @_addWatcher("issue", user, issue)

    issuesForUser: (user, callback) ->
        @_getWatched "issue", user, callback

    removeWatcherForIssue: (user, issue) ->
        @_removeWatcher("issue", user, issue)

    # Events

    handle: (event, data) ->
        switch event
            #  # commits
            #  when "push"
            #      @_handleCommit        data
            #  when "commit_comment"
            #      @_handleCommitComment data

            # issues
            when "issue"
                @_handleIssue(data.action, data)
            when "issue_comment"
                @_handleIssue("commented", data)

            # pull requests
            when "pull_request"
                @_handleIssue(data.action, data)
            when "pull_request_review_comment"
                @_handleIssue("commented", data)

    #
    # Private
    #

    # Watchers

    _typeKey: (type, name) ->
        "#{type}:#{name.toLowerCase()}"

    _userKey: (type, user) ->
        "user:#{user.id}:#{type}"

    _addWatcher: (type, user, name) ->
        typeKey = @_typeKey(type, name)
        userKey = @_userKey(type, user)

        @_redis.multi()
            .sadd(typeKey, user.id)
            .sadd(userKey, name)
            .exec()

    _getWatched: (type, user, callback) ->
        userKey = @_userKey(type, user)

        @_redis.smembers(userKey, (err, watched) ->
            callback(watched)
        )

    _removeWatcher: (type, user, name) ->
        typeKey = @_typeKey(type, name)
        userKey = @_userKey(type, user)

        @_redis.multi()
            .srem(typeKey, user.id)
            .srem(userKey, name)
            .exec()

    # Issues

    _handleIssue: (action, data) ->
        # create the event itself and start building our redis command
        event   = IssueEvent.create(action, data)
        command = @_redis.pipeline()

        # first we'll add all the participants
        participantsKey = "participants:#{event.id}"

        command = command
            .sadd(participantsKey, event.participants)
            # TODO: we expire participants after a week, so stale issues don't
            # stick around forever.  what we don't do, currently, is re-sync all
            # participants if we get an event for an expired issue.
            .expire(participantsKey, SECONDS_PER_WEEK)

        # if we don't have any details, that's all we're doing
        unless event.details
            command.exec()
            return

        # if we do have details, we need to get the right set of watchers
        watchersKeys = ["issue:#{event.id}"]

        # most of the time, we only care about the issue watchers.  in the
        # "opened" case, however, we also won't to notify the repo watchers.
        if action is "opened"
            watchersKeys.push("repo:#{event.repoId}")

        # finally we'll get all the participants and execute
        command
            .sunion(watchersKeys)
            .smembers(participantsKey)
            .exec((err, results) =>
                # TODO: remove this once things stabilize
                if err
                    console.log "err", err
                    return

                @_notify(results[2][1], results[3][1], event)
            )

    _notify: (watchers, participants, event) ->
        # make sure our messages will be formatted correctly
        details = formatNewLines(event.details)
        details.mrkdwn_in = ["pretext", "text", "fields"]

        # add the participants to the watchers
        watchers = new Set(watchers)
        senderId = event.sender.toLowerCase()

        @_redis.multi()
            .hmget("logins", participants)
            .hget("logins", senderId)
            .exec((err, results) =>
                # TODO: remove this once things stabilize
                if err
                    console.log "err", err
                    return

                for userId in results[0][1]
                    if userId
                        watchers.add(userId)

                # notify all the watchers, except the sender
                watchers.forEach((userId) =>
                    unless userId is results[1][1]
                        user = @_robot.brain.userForId(userId)

                        # TODO: handle generic sends if we're not connected to slack
                        #  @_robot.send user, details.fallback

                        @_robot.emit("slack-attachment",
                            channel:     user.name,
                            attachments: [details]
                        )
                    else
                        @_robot.logger.info("Skipping #{event.sender}: #{details.fallback}")
                )
            )

#
# Hubot
#

REDIS_URL = process.env.HUBOT_GITHUB_SPY_REDIS_URL

module.exports = (robot) ->
    redis  = new Redis(REDIS_URL)
    github = new Github(robot, redis)

    #
    # Debug
    #

    robot.on("slack-attachment", (data) ->
        console.log("slack-attachment:", JSON.stringify(data))
    )

    robot.respond(/test-attach\s+(.*)$/i, (res) ->
        data = formatNewLines(JSON.parse(res.match[1]))
        data.mrkdwn_in = ["pretext", "text", "fields"]

        robot.emit("slack-attachment",
            channel:     res.message.user.name
            attachments: data
        )
    )

    #
    # Logins
    #

    robot.respond(/alias\s+([\w-]+)\s*$/i, (res) ->
        user  = res.message.user
        alias = res.match[1]

        github.setLoginForUser(user, alias)
        res.reply("Your GitHub alias is set to #{alias}.")
    )

    robot.respond(/alias\??$/i, (res) ->
        user = res.message.user

        github.loginForUser(user, (alias) ->
            if alias
                res.reply("Your GitHub alias is set to #{alias}.")
            else
                res.reply("You haven't set a GitHub alias.")
        )
    )

    robot.respond(/unalias$/i, (res) ->
        user = res.message.user

        github.loginForUser(user, (alias) ->
            if alias
                github.setLoginForUser(user)
                res.reply("Your GitHub alias has been removed.")
            else
                res.reply("You haven't set a GitHub alias.")
        )
    )

    # Repos

    robot.respond(/watch ([\w-]+\/[\w-]+)\s*$/i, (res) ->
        user = res.message.user
        repo = res.match[1]

        github.addWatcherForRepo(user, repo)
        res.reply("You are now watching the GitHub repo #{repo}.")
    )

    robot.respond(/repos?\??\s*$/i, (res) ->
        _listReposForUser(res)
    )

    robot.respond(/unwatch ([\w-]+\/[\w-]+)\s*$/i, (res) ->
        user = res.message.user
        repo = res.match[1]

        if github.removeWatcherForRepo(user, repo)
            res.reply("You are no longer watching the GitHub repo #{repo}.")
        else
            res.reply("You are not watching the GitHub repo #{repo}.")
    )

    # Issues/PRs

    robot.respond(/watch ([\w-]+\/[\w-]+#\d+)\s*$/i, (res) ->
        user  = res.message.user
        issue = res.match[1]

        github.addWatcherForIssue(user, issue)
        res.reply("You are now watching the GitHub issue #{issue}.")
    )

    robot.respond(/issues?\??\s*$/i, (res) ->
        _listIssuesForUser(res)
    )

    robot.respond(/unwatch ([\w-]+\/[\w-]+#\d+)\s*$/i, (res) ->
        user  = res.message.user
        issue = res.match[1]

        if github.removeWatcherForIssue(user, issue)
            res.reply("You are no longer watching the GitHub issue #{issue}.")
        else
            res.reply("You are not watching the GitHub issue #{issue}.")
    )

    # Incoming

    robot.router.post("/github-spy", (req, res) ->
        event = req.headers["x-github-event"]
        body  = req.body

        github.handle(event, body)
        res.send "OK"
    )

    #
    # Private
    #

    _listReposForUser = (res) ->
        github.reposForUser(res.message.user, (repos) ->
            _listItemsForUser("repos", repos, res)
        )

    _listIssuesForUser = (res) ->
        github.issuesForUser(res.message.user, (issues) ->
            _listItemsForUser("issues", issues, res)
        )

    _listItemsForUser = (type, items, res) ->
        if items.length
            res.reply("""
                You are watching the GitHub #{type}:
                #{
                    items
                        .sort()
                        .map((item) ->
                            "  - #{item}"
                        )
                        .join("\n")
                }
            """)
        else
            res.reply("You are not watching any GitHub #{type}.")

