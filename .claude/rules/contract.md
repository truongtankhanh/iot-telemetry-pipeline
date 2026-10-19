---
paths:
  - 'packages/telemetry-contract/**'
  - 'apps/simulator/src/**'
---

# Contract and simulator rules

- `packages/telemetry-contract/src/index.ts` is the only definition of topics, payloads, metric names and
  ranges. The service and the simulator import it from `dist/`: run
  `pnpm --filter @itp/telemetry-contract build` after editing it (Turborepo does this for `pnpm` scripts).
- The parser rejects with a named reason; every reason is documented in `docs/telemetry-contract.md`. A new
  reason, a stricter rule or a new metric updates that page in the same change.
- A payload accepted by the old parser must not be rejected by a new replica without a decision: during a
  rolling deploy both versions read the same topic. Prefer additive changes.
- A metric name or range also lives in `apps/ingest/config/devices.json` and `rules.json` and in the CloudWatch
  selectors of platform-aws (checked by `apps/ingest/src/platform-aws.contract.spec.ts`).
- Tests: Vitest `*.test.ts` in the contract, `node --test` `*.test.ts` in the simulator.
- The simulator runs TypeScript directly with Node 24 (`node src/main.ts`, no build step): Node strips types, so
  syntax that needs a transform, such as enums, does not run there.
