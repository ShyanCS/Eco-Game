# AI Usage Disclosure

In the interest of transparency and professional integrity for this take-home assessment, this document outlines how AI assistance was utilized during the development of the **Eco-Game** backend service. 

## The Approach: Human-Led Architecture, AI-Accelerated Execution

This project was **not** "vibe coded" (i.e., pasting the requirements into a prompt and blindly accepting the output). As an engineer, I firmly believe that while writing raw syntax manually is no longer the most efficient use of time, **architectural ownership, technical strategy, and rigorous validation cannot be outsourced.** 

My workflow followed a standard Software Development Life Cycle (SDLC) where I acted as the Tech Lead/Architect, and AI tools were utilized as execution engines to accelerate the boilerplate and syntax generation.

### What I Owned (The Human)
- **Technical Strategy & Tech Stack Selection:** I evaluated the requirements and explicitly chose PostgreSQL and Fastify, rejecting ORMs to maintain strict, explicit control over ACID transaction boundaries and isolation levels.
- **Workflow & SDLC Management:** I broke down the prompt into a 6-phase project plan, ensuring small, incremental steps. I enforced a strict review-and-commit cycle for every phase.
- **System Design & Invariants:** I defined the exact mechanisms used for durability (relying on Postgres WAL instead of distributed locks) and idempotency (composite primary keys and atomic conditional `UPDATE` statements).
- **Code Comprehension & Review:** I reviewed every line of generated code to ensure I fully understand the data flow, the implications of the chosen isolation level (`READ COMMITTED`), and exactly how the application behaves during a mid-flight `kill -9` crash.

### What AI Handled (The Tools)
- **Google Gemini 3.1 Pro & Claude Opus 4.6:** Acted as pair-programming assistants.
- **Syntax Generation:** Used to write the core TypeScript logic, `zod` schemas, and SQL queries according to the constraints and architectural boundaries I provided.
- **Test Bootstrapping:** Generated the boilerplate for the Vitest concurrency and durability simulation tests based on the edge-case scenarios I identified.
- **Documentation Drafting:** Assisted in formatting the `README.md`, `DESIGN.md`, and `RESILIENCE.md` files based on my technical bullet points and system design decisions.

## Summary

Having access to modern AI tools means writing every line of code manually isn't always "smart work," but delegating the *understanding* of that code is a failure of engineering. I take full responsibility for this architecture, and I understand exactly what every component does, why it is necessary, and the exact impact it has on the game economy's transactional integrity.
