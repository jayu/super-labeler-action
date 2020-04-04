import * as core from '@actions/core';
import { GitHub } from '@actions/github';

import { Config } from '.';
import { addLabel, removeLabel, Repo } from './api';
import {
  getIssueConditionHandler,
  getPRConditionHandler,
  IssueCondition,
  PRCondition,
} from './conditions';
import { IssueContext, PRContext, Labels } from './parseContext';

const forConditions = <T extends IssueCondition | PRCondition>(
  conditions: T[],
  callback: (condition: T) => boolean,
) => {
  let matches = 0;
  for (const condition of conditions) {
    core.debug(`Condition: ${JSON.stringify(condition)}`);
    if (callback(condition)) {
      matches++;
    }
  }
  core.debug(`Matches: ${matches}`);
  return matches;
};

const addRemoveLabel = async ({
  client,
  curLabels,
  label,
  labelIdToName,
  matches,
  num,
  repo,
  requires,
}: {
  client: GitHub;
  curLabels: Labels;
  label: string;
  labelIdToName: { [key: string]: string };
  matches: number;
  num: number;
  repo: Repo;
  requires: number;
}): Promise<number> => {
  const labelName = labelIdToName[label];
  const hasLabel = curLabels.filter((l) => l.name === labelName).length > 0;
  if (matches >= requires && !hasLabel) {
    core.debug(`${matches} >= ${requires} matches, adding label "${label}"...`);
    await addLabel({ client, repo, num, label: labelName });
    return 1;
  }
  if (matches < requires && hasLabel) {
    core.debug(
      `${matches} < ${requires} matches, removing label "${label}"...`,
    );
    await removeLabel({ client, repo, num, label: labelName });
    return -1;
  }
  return 0;
};

export const applyIssueLabels = async ({
  client,
  config,
  config_fallback,
  issueContext,
  labelIdToName,
  repo,
}: {
  client: GitHub;
  config: Config['issue'];
  config_fallback: Config['issue_fallback'];
  issueContext: IssueContext;
  labelIdToName: { [key: string]: string };
  repo: Repo;
}) => {
  const { labels: curLabels, issueProps, num } = issueContext;

  const fallbackLabels = Array.isArray(config_fallback)
    ? config_fallback
    : config_fallback.labels;

  let nonFallbackLabelsCount = Object.keys(curLabels).filter(
    ([name, labelInfo]) => !fallbackLabels.includes(name),
  ).length;

  for (const [label, opts] of Object.entries(config)) {
    core.debug(`Label: ${label}`);

    const matches = forConditions<IssueCondition>(
      opts.conditions,
      (condition) => {
        const handler = getIssueConditionHandler(condition);
        return handler?.(condition as any, issueProps) || false;
      },
    );

    const labelsManageResult = await addRemoveLabel({
      client,
      curLabels,
      label,
      labelIdToName,
      matches,
      num,
      repo,
      requires: opts.requires,
    });
    nonFallbackLabelsCount += labelsManageResult;
  }
  const fallbackActivatesBelowCount = Array.isArray(config_fallback)
    ? 1
    : config_fallback.fallbackActivatesBelowCount;

  const addFallbackLabels =
    nonFallbackLabelsCount < fallbackActivatesBelowCount ? 1 : 0;

  core.debug(`Adding fallback labels`);
  fallbackLabels.forEach(async (label) => {
    await addRemoveLabel({
      client,
      curLabels,
      label,
      labelIdToName,
      matches: addFallbackLabels,
      num,
      repo,
      requires: 1,
    });
  });
};

export const applyPRLabels = async ({
  client,
  config,
  config_fallback,
  labelIdToName,
  prContext,
  repo,
}: {
  client: GitHub;
  config: Config['pr'];
  config_fallback: Config['pr_fallback'];
  labelIdToName: { [key: string]: string };
  prContext: PRContext;
  repo: Repo;
}) => {
  const { labels: curLabels, prProps, num } = prContext;
  for (const [label, opts] of Object.entries(config)) {
    core.debug(`Label: ${label}`);

    const matches = forConditions<PRCondition>(opts.conditions, (condition) => {
      const handler = getPRConditionHandler(condition);
      return handler?.(condition as any, prProps) || false;
    });

    await addRemoveLabel({
      client,
      curLabels,
      label,
      labelIdToName,
      matches,
      num,
      repo,
      requires: opts.requires,
    });
  }
};
