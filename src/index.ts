import fs from 'fs';
import path from 'path';

import * as core from '@actions/core';
import * as github from '@actions/github';

import { applyIssueLabels, applyPRLabels } from './applyLabels';
import { IssueCondition, PRCondition } from './conditions';
import {
  IssueContext,
  parseIssueContext,
  parsePRContext,
  PRContext,
} from './parseContext';
import syncLabels from './syncLabels';

export interface IssueConditionConfig {
  requires: number;
  conditions: IssueCondition[];
}

export interface PRConditionConfig {
  requires: number;
  conditions: PRCondition[];
}

export type Fallback =
  | Array<string>
  | { labels: Array<string>; fallbackActivationValue: number };
export interface Config {
  labels: {
    [key: string]: {
      name: string;
      colour: string;
      description: string;
    };
  };
  issue: {
    [key: string]: IssueConditionConfig;
  };
  issue_fallback: Fallback;
  pr: {
    [key: string]: PRConditionConfig;
  };
  skip_labeling: string;
  pr_fallback: Fallback;
}

const context = github.context;

(async () => {
  try {
    // Get inputs
    const token = core.getInput('github-token', { required: true });
    const configPath = path.join(
      process.env.GITHUB_WORKSPACE as string,
      core.getInput('config'),
    );
    const repo = context.repo;

    const client = new github.GitHub(token);

    // Load config
    if (!fs.existsSync(configPath)) {
      throw new Error(`config not found at "${configPath}"`);
    }
    const config: Config = JSON.parse(fs.readFileSync(configPath).toString());

    core.debug(`Config: ${JSON.stringify(config)}`);

    let curContext:
      | { type: 'pr'; context: PRContext }
      | { type: 'issue'; context: IssueContext };
    if (context.payload.pull_request) {
      const ctx = await parsePRContext(context, client, repo);
      if (!ctx) {
        throw new Error('pull request not found on context');
      }
      core.debug(`PR context: ${JSON.stringify(ctx)}`);

      curContext = {
        type: 'pr',
        context: ctx,
      };
    } else if (context.payload.issue) {
      const ctx = parseIssueContext(context);
      if (!ctx) {
        throw new Error('issue not found on context');
      }
      core.debug(`issue context: ${JSON.stringify(ctx)}`);

      curContext = {
        type: 'issue',
        context: ctx,
      };
    } else {
      return;
    }

    await syncLabels({ client, repo, config: config.labels });

    core.debug(`Create label id to name mapping`);

    // Mapping of label ids to Github names
    const labelIdToName = Object.entries(config.labels).reduce(
      (acc: { [key: string]: string }, cur) => {
        acc[cur[0]] = cur[1].name;
        return acc;
      },
      {},
    );

    if (curContext.type === 'pr') {
      core.debug(`Start apply labels to PR`);

      await applyPRLabels({
        client,
        config: config.pr,
        skipLabeling: config.skip_labeling,
        configFallback: config.pr_fallback,
        labelIdToName,
        prContext: curContext.context,
        repo,
      });
    } else if (curContext.type === 'issue') {
      core.debug(`Start apply labels to issue`);

      await applyIssueLabels({
        client,
        config: config.issue,
        skipLabeling: config.skip_labeling,
        configFallback: config.issue_fallback,
        issueContext: curContext.context,
        labelIdToName,
        repo,
      });
    }
  } catch (err) {
    core.error(err.message);
    core.setFailed(err.message);
  }
})();
