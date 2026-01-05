export function resolveRepoPath(args: {
  configuredRepoPath?: string;
  workspaceFolders?: string[];
}): string | undefined {
  const configured = (args.configuredRepoPath ?? "").trim();
  if (configured.length > 0) return configured;

  const folders = Array.isArray(args.workspaceFolders) ? args.workspaceFolders : [];
  return folders[0];
}
