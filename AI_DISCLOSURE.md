# AI Disclosure

## Tools Used

This project was built with the assistance of an AI coding assistant
(Claude, via the Antigravity IDE).

## How AI Was Used

**My role (the developer):**
- I defined the architecture, chose the tech stack, and made all design decisions
- I specified the workflow (TDD, incremental documentation)
- I decided what features to implement and how to implement them
- I reviewed all generated code for correctness, security, and logic
- I wrote commit messages and managed the git history
- I tested features and verified behavior

**The AI assistant's role:**
- Pair-programming partner: I described what I wanted, it helped write the code
- Suggested implementation patterns (e.g., idempotency middleware structure)
- Helped identify edge cases and potential issues
- Drafted documentation sections based on the decisions I made
- Provided code that I reviewed and approved before committing

## Rough Breakdown

- **Architecture & design decisions:** 100% me — I chose TypeScript/Fastify/Postgres,
  defined the schema, decided on the idempotency-key-in-header approach, chose
  READ COMMITTED over SERIALIZABLE, etc.
- **Code implementation:** Collaborative — I described what to build, reviewed
  the output, asked for improvements in logic and security
- **Tests:** Collaborative — I specified what behaviors to test (following TDD),
  reviewed test logic
- **Documentation (DESIGN.md, RESILIENCE.md):** I decided the content and
  reasoning; the assistant helped with writing and formatting
- **Debugging & iteration:** Collaborative — when tests failed, we investigated
  and fixed together

## Honest Assessment

The AI accelerated the implementation but did not replace my judgment. Every
design trade-off, every "why" in DESIGN.md, and every test scenario reflects
decisions I made. The code does what I understand it to do — I would not commit
code I couldn't explain or defend.

*This disclosure will be updated as the project progresses.*
