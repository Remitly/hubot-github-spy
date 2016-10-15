
const BaseEvent = require("./base");

module.exports = class IssueEvent extends BaseEvent {
    get subject() {
        return this.data.pull_request ? "Pull Request" : "Issue";
    }

    get info() {
        return this.data.pull_request || this.data.issue;
    }

    // BaseEvent

    buildId() {
        return `${this.repoId}#${this.info.number}`;
    }

    buildDetails() {
        this.participants.add(this.info.user.login);

        switch (this.action) {
        case "assigned":
            this._assigned();
            break;
        case "closed":
            this._closed();
            break;
        case "opened":
            this._opened();
            this.addMentions(this.info.title, this.info.body);
            break;
        case "reopened":
            this._reopened();
            break;
        case "synchronize":
            this._synchronized();
            break;
        case "unassigned":
            this._unassigned();
            break;
        default: break;
        }
    }

    pretext() {
        return `[<${this.repo.html_url}|${this.repo.full_name}>] ${this.subject} <${this.info.html_url}|#${this.info.number}: ${this.info.title}>`;
    }

    //
    // Private
    //

    _assigned() {
        this.assignee = this.data.assignee.login;
        this.participants.add(this.assignee);

        this.setDetails({
            title: `Assigned to ${this.assignee} by ${this.sender}`,
        });
    }

    _closed() {
        const verb = this.info.merged ? "Merged" : "Closed";

        this.setDetails({
            title: `${verb} by ${this.sender}`,
        });
    }

    _opened() {
        this.setDetails({
            title: `Opened by ${this.sender}`,
            text:  this.info.body,
        });
    }

    _reopened() {
        this.setDetails({
            title: `Reopened by ${this.sender}`,
        });
    }

    _synchronized() {
        this.setDetails({
            title: `Commits added by ${this.sender}`,
        });
    }

    _unassigned() {
        this.assignee = this.data.assignee.login;
        this.participants.add(this.assignee);

        this.setDetails({
            title: `Unassigned from ${this.assignee} by ${this.sender}`,
        });
    }
};
