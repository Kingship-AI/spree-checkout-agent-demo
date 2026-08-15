# Spree AI Checkout Agent

This repository contains selected, sanitized production code from the AI checkout agent used in Spree.

The agent uses Stagehand and Browserbase to navigate retailer websites, select products, complete checkout forms, and stop at the final review page before an order is placed.

## What This Sample Shows

- Browser-based AI agent workflows
- Product selection and checkout navigation
- Login and session persistence
- Checkout validation and failure handling
- Human approval before purchase

## Files

- `StagehandCheckoutAgentV2.ts` — Main checkout-agent workflow
- `loginOnboarding.ts` — Login and persistent-session setup
- `index.ts` — Entry point
- `types.ts` — Shared data types

This is a selected code sample rather than a runnable copy of the production service. Payment, credential storage, validation, and other private service integrations have been omitted.
