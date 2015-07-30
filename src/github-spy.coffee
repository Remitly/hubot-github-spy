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

EventEmitter = require("events").EventEmitter
Redis        = require("ioredis")

SECONDS_PER_WEEK = 60 * 60 * 24 * 7

formatNewLines = (obj) ->
    for key, value of obj
        if typeof value is "string" || value instanceof String
            obj[key] = value.replace /\r\n/g, "\n"
        else
            formatNewLines value
    return obj



class Issue extends EventEmitter
    # Static

    @id: (repo, info) ->
        "#{repo.full_name.toLowerCase()}##{info.number}"

    # Instance

    constructor: (repo, info) ->
        @_repo = repo
        @_info = info
        @_addParticipant repo.owner.login

    handle: (action, info, data) ->
        @_info = info

        sender = data.sender.login
        @_addParticipant sender

        @_handle action, sender, data

    #
    # Private
    #

    _addParticipant: (login) ->
        @emit "participant", login.toLowerCase()

    _handle: (action, sender, data) ->
        switch action
            when "opened"     then @_opened     sender
            when "reopened"   then @_reopened   sender
            when "assigned"   then @_assigned   sender, data.assignee.login
            when "unassigned" then @_unassigned sender
            when "commented"  then @_commented  sender, data.comment
            when "closed"     then @_closed     sender

    # TODO: having this pretext method blows
    _pretext: ->
        "[<#{@_repo.html_url}|#{@_repo.full_name}>] Issue <#{@_info.html_url}|##{@_info.number}: #{@_info.title}>"

    _notify: (type, sender, details) ->
        details.pretext  = @_pretext()
        details.fallback = "#{details.pretext}\n> #{details.title}"

        if details.text
            details.fallback += "\n> #{details.text}"

        @emit type, sender, details

    _updated: (sender, details) ->
        @_notify "updated", sender, details

    # TODO: map the github names to chat names if possible?
    _opened: (sender) ->
        @_notify "opened", sender,
            title: "Opened by #{sender}",
            text:  @_info.body

    _reopened: (sender) ->
        @_updated sender,
            title: "Reopened by #{sender}"

    _assigned: (sender, assignee) ->
        @_addParticipant assignee
        @_updated sender,
            title: "Assigned to #{assignee} by #{sender}"

    _unassigned: (sender, assignee) ->
        @_addParticipant assignee
        @_updated sender,
            title: "Unassigned from #{assignee} by #{sender}"

    _commented: (sender, comment) ->
        @_updated sender,
            title:      "Comment by #{sender}",
            title_link: comment.html_url
            text:       comment.body

    _closed: (sender) ->
        @_updated sender,
            title: "Closed by #{sender}"



class PullRequest extends Issue
    #
    # Private
    #

    _handle: (action, sender, data) ->
        switch action
            when "synchronize" then @_synchronized sender
            else super action, sender, data

    _pretext: ->
        "[<#{@_repo.html_url}|#{@_repo.full_name}>] Pull Request <#{@_info.html_url}|##{@_info.number}: #{@_info.title}>"

    _synchronized: (sender) ->
        @_updated sender,
            title: "Commits added by #{sender}"

    _closed: (sender) ->
        closeType = if @_info.merged then "Merged" else "Closed"
        @_updated sender,
            title: "#{closeType} by #{sender}"



class Github
    constructor: (robot) ->
        @_robot  = robot
        @_issues = {}

    # Logins

    setLoginForUser: (user, login) ->
        # this method can set or delete a login
        if login
            id = login.toLowerCase()

            # get the previous owner
            @_robot.db.hget "logins", id, (err, userId) =>
                # remove the login from the previous owner
                # and set up the mapping
                @_robot.db.multi()
                    .hdel("users", userId)
                    .hset("logins", id, user.id)
                    .hset("users", user.id, login)
                    .exec()
        else
            @_robot.db.hget "users", user.id, (err, login) =>
                if id = login.toLowerCase()
                    @_robot.db.multi()
                        .hdel("logins", id)
                        .hdel("users", user.id)
                        .exec()

    loginForUser: (user, callback) ->
        @_robot.db.hget "users", user.id, (err, login) ->
            callback login

    # Repos

    addWatcherForRepo: (user, repo) ->
        @_addWatcher "repo", user, repo

    reposForUser: (user, callback) ->
        @_getWatched "repo", user, callback

    removeWatcherForRepo: (user, repo) ->
        @_removeWatcher "repo", user, repo

    # Issues

    addWatcherForIssue: (user, issue) ->
        @_addWatcher "issue", user, issue

    issuesForUser: (user, callback) ->
        @_getWatched "issue", user, callback

    removeWatcherForIssue: (user, issue) ->
        @_removeWatcher "issue", user, issue

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
                @_handleIssue data.action, data
            when "issue_comment"
                @_handleIssue "commented", data

            # pull requests
            when "pull_request"
                @_handleIssue data.action, data
            when "pull_request_review_comment"
                @_handleIssue "commented", data

    #
    # Private
    #

    # Watchers

    _addWatcher: (type, user, name) ->
        typeKey = "#{type}:#{name.toLowerCase()}"
        userKey = "user:#{user.id}:#{type}"

        @_robot.db.multi()
            .sadd(typeKey, user.id)
            .sadd(userKey, name)
            .exec()

    _getWatched: (type, user, callback) ->
        userKey = "user:#{user.id}:#{type}"

        @_robot.db.smembers userKey, (err, watched) ->
            callback watched

    _removeWatcher: (type, user, name) ->
        typeKey = "#{type}:#{name.toLowerCase()}"
        userKey = "user:#{user.id}:#{type}"

        @_robot.db.multi()
            .sdel(typeKey, user.id)
            .sdel(userKey, name)
            .exec()

    # Issues

    _handleIssue: (action, data) ->
        # pull requests are just a specialized type of issue
        type = \
            if data.pull_request or data.issue?.pull_request
                PullRequest
            else
                Issue

        # get some of the basic issue info
        repo = data.repository
        info = data.pull_request or data.issue

        id              = type.id repo, info
        participantsKey = "participants:#{id}"

        # get or create the issue as required
        issue = @_issues[id]

        unless issue
            issue = new type repo, info
            @_issues[id] = issue

            # hook a couple of important events
            repoId   = repo.full_name.toLowerCase()
            repoKey  = "repo:#{repoId}"
            issueKey = "issue:#{id}"

            issue.on "participant", (login) =>
                @_robot.db.pipeline()
                    .sadd(participantsKey, login)
                    .expire(participantsKey, SECONDS_PER_WEEK)
                    .exec()

            issue.on "opened", (sender, details) =>
                @_robot.db.multi()
                    .sunion(repoKey, issueKey)
                    .smembers(participantsKey)
                    .exec (err, results) =>
                        @_notify results[0][1], results[1][1], sender, details

            issue.on "updated", (sender, details) =>
                @_robot.db.multi()
                    .smembers(issueKey)
                    .smembers(participantsKey)
                    .exec (err, results) =>
                        @_notify results[0][1], results[1][1], sender, details

        # let the issue handle the action
        issue.handle action, info, data

    _notify: (watchers, participants, sender, details) ->
        # make sure our messages will be formatted correctly
        details = formatNewLines details
        details.mrkdwn_in = ["pretext", "text", "fields"]

        # add the participants to the watchers
        watchers = new Set watchers
        senderId = sender.toLowerCase()

        @_robot.db.multi()
            .hmget("logins", participants)
            .hget("logins", senderId)
            .exec (err, results) =>
                for userId in results[0][1]
                    if userId
                        watchers.add userId

                # notify all the watchers, except the sender
                watchers.forEach (userId) =>
                    unless userId is results[1][1]
                        user = @_robot.brain.userForId userId

                        # TODO: handle generic sends if we're not connected to slack
                        #  @_robot.send user, details.fallback

                        @_robot.emit "slack-attachment",
                            channel:     user.name,
                            attachments: [details]
                    else
                        @_robot.logger.info "Skipping #{sender}: #{details.fallback}"



module.exports = (robot) ->
    redisUrl = process.env.HUBOT_GITHUB_SPY_REDIS_URL
    robot.db = new Redis redisUrl
    github   = new Github robot

    robot.on "slack-attachment", (data) ->
        console.log "slack-sttachment:", JSON.stringify data

    robot.respond /test-attach\s+(.*)$/i, (res) ->
        data = formatNewLines JSON.parse res.match[1]
        data.mrkdwn_in = ["pretext", "text", "fields"]

        robot.emit "slack-attachment",
            channel:     res.message.user.name
            attachments: data

    #
    # Logins
    #

    robot.respond /alias\s+([\w-]+)\s*$/i, (res) ->
        user  = res.message.user
        alias = res.match[1]

        github.setLoginForUser user, alias
        res.reply "Your GitHub alias is set to #{alias}."

    robot.respond /alias\??$/i, (res) ->
        user = res.message.user

        github.loginForUser user, (alias) ->
            if alias
                res.reply "Your GitHub alias is set to #{alias}."
            else
                res.reply "You haven't set a GitHub alias."

    robot.respond /unalias$/i, (res) ->
        user = res.message.user

        github.loginForUser user, (alias) ->
            if alias
                github.setLoginForUser user
                res.reply "Your GitHub alias has been removed."
            else
                res.reply "You haven't set a GitHub alias."

    # Repos

    robot.respond /watch ([\w-]+\/[\w-]+)\s*$/i, (res) ->
        user = res.message.user
        repo = res.match[1]

        github.addWatcherForRepo user, repo
        res.reply "You are now watching the GitHub repo #{repo}."

    robot.respond /repos?\??\s*$/i, (res) ->
        _listReposForUser res

    robot.respond /unwatch ([\w-]+\/[\w-]+)\s*$/i, (res) ->
        user = res.message.user
        repo = res.match[1]

        if github.removeWatcherForRepo user, repo
            res.reply "You are no longer watching the GitHub repo #{repo}."
        else
            res.reply "You are not watching the GitHub repo #{repo}."

    # Issues/PRs

    robot.respond /watch ([\w-]+\/[\w-]+#\d+)\s*$/i, (res) ->
        user  = res.message.user
        issue = res.match[1]

        github.addWatcherForIssue user, issue
        res.reply "You are now watching the GitHub issue #{issue}."

    robot.respond /issues?\??\s*$/i, (res) ->
        _listIssuesForUser res

    robot.respond /unwatch ([\w-]+\/[\w-]+#\d+)\s*$/i, (res) ->
        user  = res.message.user
        issue = res.match[1]

        if github.removeWatcherForIssue user, issue
            res.reply "You are no longer watching the GitHub issue #{issue}."
        else
            res.reply "You are not watching the GitHub issue #{issue}."

    # Incoming

    robot.router.post "/github-spy", (req, res) ->
        event = req.headers["x-github-event"]
        body  = req.body

        github.handle event, body
        res.send "OK"

    #
    # Private
    #

    _listReposForUser = (res) ->
        github.reposForUser res.message.user, (repos) ->
            _listItemsForUser "repos", repos, res

    _listIssuesForUser = (res) ->
        github.issuesForUser res.message.user, (issues) ->
            _listItemsForUser "issues", issues, res

    _listItemsForUser = (type, items, res) ->
        if items.length
            res.reply """
                You are watching the GitHub #{type}:
                #{items
                    .sort()
                    .map (item) ->
                        "  - #{item}"
                    .join "\n"
                }
            """
        else
            res.reply "You are not watching any GitHub #{type}."

