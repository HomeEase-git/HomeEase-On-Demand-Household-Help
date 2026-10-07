import { useMessageStore, type Message } from "../messageStore";

const m = (id: string): Message => ({ id, senderId: "u", receiverId: "me", content: id, createdAt: "2026-10-07T00:00:00.000Z" });

it("prependMessages puts older messages first and skips ones already shown", () => {
  useMessageStore.setState({ messagesByUser: { u: [m("c"), m("d")] } });
  useMessageStore.getState().prependMessages("u", [m("a"), m("b"), m("c")]);
  expect(useMessageStore.getState().messagesByUser.u.map((x) => x.id)).toEqual(["a", "b", "c", "d"]);
});
