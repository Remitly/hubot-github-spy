
const BaseEvent = require("./base");

module.exports = class CommitCommentEvent extends BaseEvent {
    // BaseEvent

    buildId() {
        return `${this.repoId}/${this._commitId()}`;
    }

    buildDetails() {
        this.buildCommentDetails();
    }

    pretext() {
        return `[<${this.repo.html_url}|${this.repo.full_name}>] Commit <${this.repo.html_url}/commit/${this._commitId()}|${this._commitId().substr(0, 7)}: ${this._title()}>`;
    }

    //
    // Private
    //

    _commitId() {
        return this.comment.commit_id;
    }

    _title() {
        const title = this.comment.title;

        return title ?
            title.split("\n", 1)[0] :
            "No title";
    }
};
