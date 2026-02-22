# Incident Runbook

## Trigger
- Production error spike
- Critical workflow broken
- Eval regression gate turned BLOCKED after release

## Immediate Steps
1. Freeze risky changes.
2. Capture current error logs and recent deploy info.
3. Decide rollback target version.
4. Roll back to last known good release.
5. Verify health and key user journey.

## Communication
- Owner:
- Backup owner:
- Status channel:
- Update interval:

## Technical Checklist
- [ ] Rollback executed
- [ ] Snapshot/config restored
- [ ] Smoke tests passed
- [ ] Eval gate status checked (`/eval run`)
- [ ] Root cause ticket opened

## Postmortem
- What failed:
- Why failed:
- Detection gap:
- Permanent fix:
- Preventive rule added:

