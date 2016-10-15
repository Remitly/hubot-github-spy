
const Events = require("../index");

describe("Events", () => {
    it("only handles expected events", () => {
        const event = Events.create("FAKE", null);
        expect(event).toBe(null);
    });
});
