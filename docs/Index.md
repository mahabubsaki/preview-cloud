# 🏗️ GitHub App — Preview Deployment System
## Project Vault Index

Welcome to the internal documentation vault for the Preview Deployment System. This vault is designed for **Obsidian** to help you visualize the relations between components.

### 🗺️ Architecture Overview
- [[High-Level Architecture]]
- [[Deployment Flow]]
- [[System Design Goals]]

### 🧱 Core Components
- [[GitHub App Server]] — The webhook entry point.
- [[Discord Bot]] — The human-in-the-loop approval gate.
- [[Deployment Orchestrator]] — The engine that builds and deploys.
- [[ENV Server]] — Secure storage for project secrets.
- [[Management Dashboard]] — Web UI for project configuration.
- [[Infrastructure]] — Docker hosting and Traefik routing.

### 🛠️ Technical Specs
- [[Database Schema]]
- [[API Contracts]]
- [[Security Considerations]]

### 🌊 Effect Reference
- [[Effect/Overview|Overview]] — Core concepts, the `Effect` type, generators, runners
- [[Effect/Configuration|Configuration]] — `Config`, `Redacted`, providers, and validation
- [[Effect/Error-Handling|Error Handling]] — Tagged errors, retries, timeouts, `Schedule`
- [[Effect/Concurrency|Concurrency]] — Fibers, `Effect.all`, racing, interruption, Queue, PubSub
- [[Effect/Services-and-Layers|Services & Layers]] — Dependency injection, `Layer`, testing with mocks
- [[Effect/Resource-Management|Resource Management]] — `acquireRelease`, `Scope`, finalizers, caching
- [[Effect/Data-Types|Data Types]] — `Option`, `Either`, `Brand`, `Data.TaggedError`, `Redacted`

### 🗺️ Migration Guides
- [[Effect/Orchestrator-Migration|Orchestrator → Effect Migration]] — Step-by-step plan

---
*Status: In Development*
*Last Updated: 2026-05-01*
