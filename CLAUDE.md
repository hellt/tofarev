# Writing rules

Apply ASD-STE100 Simplified Technical English principles to documentation and casual replies.

- Limit each prose sentence to 20 words.
- Use active voice and plain verbs.
- Give each instruction one main action.
- Use one name for each component.
- Define technical terms before you use them.
- State conditions before their related actions.
- Separate verified behavior from proposed changes.
- Describe security controls and their limits accurately.
- Keep commands, API names, and file paths exact.
- Do not claim full ASD-STE100 compliance without a formal check.

Use these component names consistently:

- Caller workflow: the workflow installed in Containerlab.
- Bot workflow: the reusable workflow stored in ToFaRev.
- Prepare job: the job that records the request and prepares source files.
- Review job: the job that runs the review container.
- Publish job: the job that updates the bot comment.
- Review container: the Docker container that runs the review process.
- OpenCode: the agent runtime inside the review container.
- Token Factory: the Nebius service that runs the model.
- Source snapshot: the selected source files prepared from recorded Git revisions.
