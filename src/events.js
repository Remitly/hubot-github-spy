
"use strict";

//
// Github Events
//

class IssueEvent {
    constructor(repo, info, action, data) {
        this.repo   = repo;
        this.info   = info;
        this.action = action;
        this.data   = data;
        this.repoId = this.repo.full_name.toLowerCase();

        this.id           = `${this.repoId}#${this.info.number}`;
        this.sender       = this.data.sender.login;
        this.participants = [...new Set([this.repo.owner.login, this.info.user.login, this.sender])];

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

        if (this.participants.indexOf(this.assignee) === -1) {
            this.participants.push(this.assignee);
        }

        this._setDetails({
            title: `Assigned to ${this.assignee} by ${this.sender}`
        });
    }

    _unassigned() {
        this.assignee = this.data.assignee.login;

        if (this.participants.indexOf(this.assignee) === -1) {
            this.participants.push(this.assignee);
        }

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

module.exports = {
    create(action, data) {
        // pull requests are just a specialized type of issue
        const type = data.pull_request || (data.issue && data.issue.pull_request) ? PullRequestEvent : IssueEvent;

        // get some of the basic issue info
        const repo = data.repository;
        const info = data.pull_request || data.issue;

        // create and return the event type
        return new type(repo, info, action, data);
    }
};

