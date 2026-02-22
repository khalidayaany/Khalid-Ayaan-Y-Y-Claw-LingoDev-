# Staging And Observability Checklist

## Staging
- [ ] Dedicated staging env
- [ ] Safe seed data (no production PII)
- [ ] Config parity with production
- [ ] Rollback script validated

## Observability
- [ ] Error logs accessible
- [ ] Trace/span visibility enabled
- [ ] Cost visibility enabled (scheduler telemetry)
- [ ] Alert channel configured

## Regression Gate
- [ ] Eval cases defined (`~/.hakathone/store/eval-harness/cases.json`)
- [ ] `/eval run` pass rate baseline established
- [ ] Gate threshold reviewed

