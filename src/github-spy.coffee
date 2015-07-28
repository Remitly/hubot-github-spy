
EventEmitter = require("events").EventEmitter

Array.from ?= (arrayLike) ->
    array = []

    arrayLike.forEach (item) ->
        array.push(item)

    array



class Issue extends EventEmitter
    # Static

    @id: (repo, info) ->
        "#{repo.full_name}##{info.number}"

    # Instance

    constructor: (repo, info) ->
        @_repo = repo
        @_info = info

        @_participants = new Set
        @_participants.add repo.owner.login

    handle: (action, data) ->
        sender = data.sender.login
        @_participants.add sender

        @_handle action, sender, data

    #
    # Private
    #

    _handle: (action, sender, data) ->
        switch action
            when "opened"     then @_opened     sender
            when "reopened"   then @_reopened   sender
            when "assigned"   then @_assigned   sender, data.assignee.login
            when "unassigned" then @_unassigned sender
            when "commented"  then @_commented  sender, data.comment
            when "closed"     then @_closed     sender

    _header: ->
        "[<#{@_repo.html_url}|#{@_repo.full_name}>] <#{@_info.html_url}|##{@_info.number}: #{@_info.title}>\n"

    _opened: (sender) ->
        @emit "opened",  @_participants, sender, @_header() + "> *Opened by #{sender}*\n> #{@_info.body}"

    _updated: (sender, text) ->
        @emit "updated", @_participants, sender, @_header() + text

    _reopened: (sender) ->
        @_updated sender, "> *Reopened by #{sender}*"

    _assigned: (sender, assignee) ->
        @_participants.add assignee
        @_updated sender, "> *Assigned to #{assignee} by #{sender}*"

    _unassigned: (sender, assignee) ->
        @_participants.add assignee
        @_updated sender, "> *Assigned from #{assignee} by #{sender}*"

    _commented: (sender, comment) ->
        @_updated sender, "> *Comment by #{sender}*\n> #{comment.body}"

    _closed: (sender) ->
        @_updated sender, "> *Closed by #{sender}*"



class PullRequest extends Issue
    #
    # Private
    #

    _handle: (action, sender, data) ->
        switch action
            when "synchronize" then @_synchronized sender
            else super action, sender, data

    _synchronized: (sender) ->
        @_updated sender, "> *Commits added by #{sender}*"

    _closed: (sender) ->
        closeType = if @_info.merged then "Merged" else "Closed"
        @_updated sender, "> *#{closeType} by #{sender}*"



class Github
    constructor: (robot) ->
        @_robot  = robot
        @_logins = {}
        @_issues = {}

        @_watchers =
            repos:  new Set
            issues: new Set

    # Logins

    setLoginForUser: (user, login) ->
        if login?
            @_logins[login] = user.id

            @_infoForUser user
            user._github.login = login
        else
            delete @_logins[login]
            delete user._github?.login

    loginForUser: (user) ->
        user._github?.login

    # Repos

    addWatcherForRepo: (user, repo) ->
        @_addWatcher "repos", user, repo

    reposForUser: (user) ->
        user._github?.repos

    removeWatcherForRepo: (user, repo) ->
        @_removeWatcher "repos", user, repo

    # Issues

    addWatcherForIssue: (user, issue) ->
        @_addWatcher "issues", user, issue

    issuesForUser: (user) ->
        user._github?.issues

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
            repos:  new Set
            issues: new Set

    # Watchers

    _addWatcher: (key, user, id) ->
        watchers = @_watchers[key][id]

        unless watchers
            watchers = new Set
            @_watchers[key][id] = watchers

        watchers.add user.id

        @_infoForUser user
        user._github[key].add id

    _removeWatcher: (key, user, id) ->
        @_watchers[key][id]?.delete user.id
        user._github?[key].delete id

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
            issue.on "opened", (participants, sender, text) =>
                watchers = new Set @_watchers.issues[id]

                @_watchers.repos[repo.full_name]?.forEach (watcher) ->
                    watchers.add watcher

                @_notify watchers, participants, sender, text

            issue.on "updated", (participants, sender, text) =>
                watchers = new Set @_watchers.issues[id]
                @_notify watchers, participants, sender, text

        # let the issue handle the action
        issue.handle action, data

    _notify: (watchers, participants, sender, text) ->
        # add the participants to the watchers
        participants.forEach (login) =>
            userId = @_logins[login]

            if userId
                watchers.add userId

        # notify all the watchers, except the sender
        watchers.forEach (userId) =>
            user = @_robot.brain.userForId userId

            unless sender is user._github.login
                @_robot.send user, text
            else
                @_robot.logger.info "Skipping #{sender}: #{text}"



module.exports = (robot) ->
    github = new Github robot

    # Logins

    robot.respond /alias ([a-zA-Z-]+)\s*$/i, (res) ->
        user  = res.message.user
        alias = res.match[1]

        github.setLoginForUser user, alias
        res.reply "Your GitHub alias is set to #{alias}."

    robot.respond /alias\??$/i, (res) ->
        user  = res.message.user
        alias = github.loginForUser user

        if alias?
            res.reply "Your GitHub alias is set to #{alias}."
        else
            res.reply "You haven't set a GitHub alias."

    robot.respond /unalias$/i, (res) ->
        user  = res.message.user
        alias = github.loginForUser user

        if alias?
            github.setLoginForUser user
            res.reply "Your GitHub alias has been removed."
        else
            res.reply "You haven't set a GitHub alias."

    # Repos

    robot.respond /watch ([a-zA-Z-]+\/[a-zA-Z-]+)\s*$/i, (res) ->
        user = res.message.user
        repo = res.match[1]

        github.addWatcherForRepo user, repo
        res.reply "You are now watching the GitHub repo #{repo}."

    robot.respond /repos?\??\s*$/i, (res) ->
        _listReposForUser res

    robot.respond /unwatch ([a-zA-Z-]+\/[a-zA-Z-]+)\s*$/i, (res) ->
        user = res.message.user
        repo = res.match[1]

        repos = github.reposForUser user

        if repos?.has repo
            github.removeWatcherForRepo user, repo
            res.reply "You are no longer watching the GitHub repo #{repo}."
        else
            res.reply "You are not watching the GitHub repo #{repo}."

    # Issues/PRs

    robot.respond /watch ([a-zA-Z-]+\/[a-zA-Z-]+#\d+)\s*$/i, (res) ->
        user  = res.message.user
        issue = res.match[1]

        github.addWatcherForIssue user, issue
        res.reply "You are now watching the GitHub issue #{issue}."

    robot.respond /issues?\??\s*$/i, (res) ->
        _listIssuesForUser res

    robot.respond /unwatch ([a-zA-Z-]+\/[a-zA-Z-]+#\d+)\s*$/i, (res) ->
        user  = res.message.user
        issue = res.match[1]

        issues = github.issuesForUser user

        if issues?.has issue
            github.removeWatcherForIssue user, issue
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
        if items?.size
            text  = "You are watching the GitHub #{type}:\n"
            text += Array.from(items)
                .sort()
                .map (item) ->
                    "  - #{item}"
                .join "\n"
            res.reply text
        else
            res.reply "You are not watching any GitHub #{type}."

