
const IssueEvent = require("./issue");

module.exports = class PullRequestEvent extends IssueEvent {
    //
    // Private
    //

    _buildDetails() {
        switch (this.action) {
        case "synchronize":
            this._synchronized();
            break;
        default:
            super._buildDetails();
            break;
        }
    }

    _pretext() {
        return `[<${this.repo.html_url}|${this.repo.full_name}>] Pull Request <${this.info.html_url}|#${this.info.number}: ${this.info.title}>`;
    }

    _synchronized() {
        this._setDetails({
            title: `Commits added by ${this.sender}`,
        });
    }

    _closed() {
        const closeAction = this.info.merged ? "Merged" : "Closed";

        this._setDetails({
            title: `${closeAction} by ${this.sender}`,
        });
    }
};
