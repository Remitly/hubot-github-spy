
const IssueEvent = require("./issue");

module.exports = class ReviewEvent extends IssueEvent {
    get subject() {
        return "Pull Request";
    }

    get info() {
        return this.data.pull_request;
    }

    get review() {
        return this.data.review;
    }

    get isComment() {
        return this.review.state === "commented";
    }

    // BaseEvent

    buildId() {
        return `${this.repoId}#${this.info.number}`;
    }

    buildDetails() {
        let title;
        switch (this.review.state) {
        case "approved":
            title = "Approved";
            break;

        case "changes_requested":
            title = "Changes requested";
            break;

        case "commented":
        default:
            title = "Reviewed";
        }

        this.participants.add(this.info.user.login);
        this.participants.add(this.review.user.login);

        this.addMentions(this.review.body);
        this.setDetails({
            title:      `${title} by ${this.sender}`,
            title_link: this.review.html_url,
            text:       this.review.body,
        });
    }
};
