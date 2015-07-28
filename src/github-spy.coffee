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



class Issue extends EventEmitter
    # Static

    @id: (repo, info) ->
        "#{repo.full_name.toLowerCase()}##{info.number}"

    # Instance

    constructor: (repo, info) ->
        @_repo = repo
        @_info = info

        @_participants = new Set
        @_addParticipant repo.owner.login

    handle: (action, data) ->
        sender = data.sender.login
        @_addParticipant sender

        @_handle action, sender, data

    #
    # Private
    #

    _addParticipant: (login) ->
        @_participants.add login.toLowerCase()

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

        @emit type, @_participants, sender, details

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
        @_logins = {}
        @_issues = {}

        @_watchers =
            repos:  {}
            issues: {}

    # Logins

    setLoginForUser: (user, login) ->
        # this method can set or delete a login
        if login
            id = login.toLowerCase()

            # remove the login from the previous owner
            if userId = @_logins[id]
                previous = @_robot.brain.userForId userId
                delete previous._github?.login

            # set up the new login mapping
            @_logins[id] = user.id
            info = @_infoForUser user
            info.login = login

        else if id = user._github?.login?.toLowerCase()
            delete @_logins[id]
            delete user._github.login

    loginForUser: (user) ->
        user._github?.login

    # Repos

    addWatcherForRepo: (user, repo) ->
        @_addWatcher "repos", user, repo

    reposForUser: (user) ->
        (name for id, name of user._github?.repos)

    removeWatcherForRepo: (user, repo) ->
        @_removeWatcher "repos", user, repo

    # Issues

    addWatcherForIssue: (user, issue) ->
        @_addWatcher "issues", user, issue

    issuesForUser: (user) ->
        (name for id, name of user._github?.issues)

    removeWatcherForIssue: (user, issue) ->
        @_removeWatcher "repos", user, repo

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

    _infoForUser: (user) ->
        user._github ?=
            repos:  {}
            issues: {}

    # Watchers

    _addWatcher: (key, user, name) ->
        id = name.toLowerCase()

        watchers = @_watchers[key][id] ?= new Set
        watchers.add user.id

        info = @_infoForUser user
        info[key][id] = name

    _removeWatcher: (key, user, name) ->
        id = name.toLowerCase()

        @_watchers[key][id]?.delete user.id
        delete user._github?[key][id]

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
        id   = type.id repo, info

        # get or create the issue as required
        issue = @_issues[id]

        unless issue
            issue = new type repo, info
            @_issues[id] = issue

            # hook a couple of important events
            repoId = repo.full_name.toLowerCase()

            issue.on "opened", (participants, sender, details) =>
                watchers = new Set @_watchers.issues[id]

                @_watchers.repos[repoId]?.forEach (watcher) ->
                    watchers.add watcher

                @_notify watchers, participants, sender, details

            issue.on "updated", (participants, sender, details) =>
                watchers = new Set @_watchers.issues[id]
                @_notify watchers, participants, sender, details

        # let the issue handle the action
        issue.handle action, data

    _notify: (watchers, participants, sender, details) ->
        # add the participants to the watchers
        participants.forEach (login) =>
            if userId = @_logins[login]
                watchers.add userId

        # notify all the watchers, except the sender
        senderId = sender.toLowerCase()

        watchers.forEach (userId) =>
            unless @_logins[senderId] is userId
                user = @_robot.brain.userForId userId

                # TODO: handle generic sends if we're not connected to slack
                #  @_robot.send user, details.fallback

                @_robot.emit "slack-attachment",
                    channel:     user.name,
                    attachments: [details]
            else
                @_robot.logger.info "Skipping #{sender}: #{details.fallback}"



module.exports = (robot) ->
    github = new Github robot

    robot.on "slack-attachment", (data) ->
        console.log data
    jared = robot.brain.userForName "jared"
    if jared then github.setLoginForUser jared, "jaredru"

    #
    # Logins
    #

    robot.respond /alias\s+([\w-]+)\s*$/i, (res) ->
        user  = res.message.user
        alias = res.match[1]

        github.setLoginForUser user, alias
        res.reply "Your GitHub alias is set to #{alias}."

    robot.respond /alias\??$/i, (res) ->
        user  = res.message.user
        alias = github.loginForUser user

        if alias
            res.reply "Your GitHub alias is set to #{alias}."
        else
            res.reply "You haven't set a GitHub alias."

    robot.respond /unalias$/i, (res) ->
        user  = res.message.user
        alias = github.loginForUser user

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
        repos = github.reposForUser res.message.user
        _listItemsForUser "repos", repos, res

    _listIssuesForUser = (res) ->
        issues = github.issuesForUser res.message.user
        _listItemsForUser "issues", issues, res

    _listItemsForUser = (type, items, res) ->
        if items.length
            res.reply """
                You are watching the GitHub #{type}
                #{items
                    .sort()
                    .map (item) ->
                        "  - #{item}"
                    .join "\n"
                }
            """
        else
            res.reply "You are not watching any GitHub #{type}."

