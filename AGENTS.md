# Agent instructions

## Ship every change

After each change, commit, push to `main` and make sure the deploy finishes. Don't wait to be asked.

1. Run the checks: `pnpm test` and `pnpm type-check`.
2. Commit with a message that says what changed for the user, then `git push origin main`.
3. Pushing to `main` runs `.github/workflows/deploy.yml`. Watch it (`gh run watch`) and report whether it succeeded.

If the change touches the activity crawler, re-run `pnpm activities` and commit the updated `public/activities.json` in the same push.
