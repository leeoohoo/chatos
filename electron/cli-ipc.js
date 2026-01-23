const IPC_CHANNELS = Object.freeze({
  cliStatus: 'cli:status',
  cliInstall: 'cli:install',
  cliUninstall: 'cli:uninstall',
});

function createCliIpcHandlers({
  ipcMain,
  createActionId,
  logInstall,
  cliShim,
  legacyCliShim,
  commandName,
}) {
  if (!ipcMain || !cliShim) return;

  ipcMain.handle(IPC_CHANNELS.cliStatus, async () => {
    const status = cliShim.getCliCommandStatus();
    if (!legacyCliShim) return status;
    const legacy = legacyCliShim.getCliCommandStatus();
    return {
      ...status,
      legacyCommand: legacy.command,
      legacyInstalled: legacy.installed,
      legacyInstalledPath: legacy.installedPath,
    };
  });

  ipcMain.handle(IPC_CHANNELS.cliInstall, async (_event, payload = {}) => {
    const actionId = createActionId('cli_install');
    const force = payload?.force === true;
    logInstall('info', 'cli.install.start', { actionId, force, command: commandName });
    const result = cliShim.installCliCommand({ force });
    if (!legacyCliShim) {
      logInstall('info', 'cli.install.complete', {
        actionId,
        ok: result?.ok === true,
        reason: result?.reason || '',
        installedPath: result?.installedPath || '',
      });
      return { ...result, logId: actionId };
    }
    const legacy = legacyCliShim.getCliCommandStatus();
    const shouldRemoveLegacy = result?.ok === true || result?.reason === 'exists';
    if (!shouldRemoveLegacy) {
      const payloadResult = {
        ...result,
        legacyCommand: legacy.command,
        legacyInstalled: legacy.installed,
        legacyInstalledPath: legacy.installedPath,
      };
      logInstall('warn', 'cli.install.legacy_preserved', {
        actionId,
        ok: payloadResult?.ok === true,
        reason: payloadResult?.reason || '',
      });
      return { ...payloadResult, logId: actionId };
    }
    const legacyRemoved = legacyCliShim.uninstallCliCommand();
    const payloadResult = {
      ...result,
      legacyCommand: legacyRemoved.command,
      legacyInstalled: legacyRemoved.installed,
      legacyInstalledPath: legacyRemoved.installedPath,
      legacyRemovedPath: legacyRemoved.removedPath,
    };
    logInstall('info', 'cli.install.complete', {
      actionId,
      ok: payloadResult?.ok === true,
      reason: payloadResult?.reason || '',
      installedPath: payloadResult?.installedPath || '',
      legacyRemovedPath: payloadResult?.legacyRemovedPath || '',
    });
    return { ...payloadResult, logId: actionId };
  });

  ipcMain.handle(IPC_CHANNELS.cliUninstall, async () => {
    const actionId = createActionId('cli_uninstall');
    logInstall('info', 'cli.uninstall.start', { actionId, command: commandName });
    const result = cliShim.uninstallCliCommand();
    if (!legacyCliShim) {
      logInstall('info', 'cli.uninstall.complete', {
        actionId,
        ok: result?.ok === true,
        removedPath: result?.removedPath || '',
      });
      return { ...result, logId: actionId };
    }
    const legacyRemoved = legacyCliShim.uninstallCliCommand();
    const payloadResult = {
      ...result,
      legacyCommand: legacyRemoved.command,
      legacyInstalled: legacyRemoved.installed,
      legacyInstalledPath: legacyRemoved.installedPath,
      legacyRemovedPath: legacyRemoved.removedPath,
    };
    logInstall('info', 'cli.uninstall.complete', {
      actionId,
      ok: payloadResult?.ok === true,
      removedPath: payloadResult?.removedPath || '',
      legacyRemovedPath: payloadResult?.legacyRemovedPath || '',
    });
    return { ...payloadResult, logId: actionId };
  });
}

export { createCliIpcHandlers, IPC_CHANNELS };
