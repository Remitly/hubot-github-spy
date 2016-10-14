
const BaseEvent = require("./base");

module.exports = class IssueEvent extends BaseEvent {
    //
    // Private
    //

    _buildDetails() {
        switch (this.action) {
        case "opened":
            this._opened();
            this._buildMentions(this.info.title, this.info.body);
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
            this._buildMentions(this.comment.body);
            break;
        case "closed":
            this._closed();
            break;

        default: break;
        }
    }

    _pretext() {
        return `[<${this.repo.html_url}|${this.repo.full_name}>] Issue <${this.info.html_url}|#${this.info.number}: ${this.info.title}>`;
    }

    // TODO: map the github names to chat names if possible?
    _opened() {
        this._setDetails({
            title: `Opened by ${this.sender}`,
            text:  this.info.body,
        });
    }

    _reopened() {
        this._setDetails({
            title: `Reopened by ${this.sender}`,
        });
    }

    _assigned() {
        this.assignee = this.data.assignee.login;

        if (this.participants.indexOf(this.assignee) === -1) {
            this.participants.push(this.assignee);
        }

        this._setDetails({
            title: `Assigned to ${this.assignee} by ${this.sender}`,
        });
    }

    _unassigned() {
        this.assignee = this.data.assignee.login;

        if (this.participants.indexOf(this.assignee) === -1) {
            this.participants.push(this.assignee);
        }

        this._setDetails({
            title: `Unassigned from ${this.assignee} by ${this.sender}`,
        });
    }

    _commented() {
        this.comment = this.data.comment;

        this._setDetails({
            title:      `Comment by ${this.sender}`,
            title_link: this.comment.html_url,
            text:       this.comment.body,
        });
    }

    _closed() {
        this._setDetails({
            title: `Closed by ${this.sender}`,
        });
    }
};
