import test from "node:test";
import assert from "node:assert/strict";

import {
  isMsysCygdrivePath,
  isWindowsOpenSshSftpPath,
  toMsysCygdrivePath,
  toWindowsOpenSshSftpPath,
  translateGitBashCwdForSftpPane,
  windowsUserPathsReferToSameLocation,
} from "./windowsShellPaths.ts";

test("isMsysCygdrivePath matches only a single-letter first segment", () => {
  assert.equal(isMsysCygdrivePath("/c/Users/521523"), true);
  assert.equal(isMsysCygdrivePath("/c"), true);
  assert.equal(isMsysCygdrivePath("/C:/Users/521523"), false);
  assert.equal(isMsysCygdrivePath("/usr/bin"), false);
  assert.equal(isMsysCygdrivePath("/home/user"), false);
});

test("isWindowsOpenSshSftpPath matches drive-colon paths with a leading slash", () => {
  assert.equal(isWindowsOpenSshSftpPath("/C:/Users/521523"), true);
  assert.equal(isWindowsOpenSshSftpPath("/c:/Users/521523"), true);
  assert.equal(isWindowsOpenSshSftpPath("/c/Users/521523"), false);
  assert.equal(isWindowsOpenSshSftpPath("C:\\Users\\521523"), false);
});

test("toMsysCygdrivePath converts OpenSSH and Win32 paths for Git Bash cd", () => {
  assert.equal(toMsysCygdrivePath("/C:/Users/521523/Contacts"), "/c/Users/521523/Contacts");
  assert.equal(toMsysCygdrivePath("/c/Users/521523/Contacts"), "/c/Users/521523/Contacts");
  assert.equal(toMsysCygdrivePath("C:\\Users\\521523\\Contacts"), "/c/Users/521523/Contacts");
  assert.equal(toMsysCygdrivePath("C:/Users/521523/Contacts"), "/c/Users/521523/Contacts");
  assert.equal(toMsysCygdrivePath("/C:/"), "/c");
  assert.equal(toMsysCygdrivePath("/home/user"), null);
});

test("toWindowsOpenSshSftpPath converts Git Bash cwd for SFTP", () => {
  assert.equal(toWindowsOpenSshSftpPath("/c/Users/521523/Contacts"), "/C:/Users/521523/Contacts");
  assert.equal(toWindowsOpenSshSftpPath("/C:/Users/521523/Contacts"), "/C:/Users/521523/Contacts");
  assert.equal(toWindowsOpenSshSftpPath("C:\\Users\\521523\\Contacts"), "/C:/Users/521523/Contacts");
  assert.equal(toWindowsOpenSshSftpPath("/d"), "/D:/");
  assert.equal(toWindowsOpenSshSftpPath("/usr/bin"), null);
});

test("translateGitBashCwdForSftpPane uses OpenSSH dialect on /C:/ panes", () => {
  assert.equal(
    translateGitBashCwdForSftpPane("/c/Users/521523/Contacts", "/C:/Users/521523", null),
    "/C:/Users/521523/Contacts",
  );
  assert.equal(
    translateGitBashCwdForSftpPane("/C:/Users/521523/Contacts", "/C:/Users/521523"),
    "/C:/Users/521523/Contacts",
  );
});

test("translateGitBashCwdForSftpPane uses Win32 dialect on C:\\ panes", () => {
  assert.equal(
    translateGitBashCwdForSftpPane("/c/Users/521523/czh", "C:\\Users\\521523", null),
    "C:/Users/521523/czh",
  );
});

test("translateGitBashCwdForSftpPane leaves POSIX panes unchanged", () => {
  assert.equal(
    translateGitBashCwdForSftpPane("/c/Users/521523", "/home/user", null),
    "/c/Users/521523",
  );
  assert.equal(
    translateGitBashCwdForSftpPane("/usr/bin", "/C:/Users/521523"),
    "/usr/bin",
  );
});

test("windowsUserPathsReferToSameLocation equates Git Bash and OpenSSH forms", () => {
  assert.equal(
    windowsUserPathsReferToSameLocation("/c/Users/521523/Contacts", "/C:/Users/521523/Contacts"),
    true,
  );
  assert.equal(
    windowsUserPathsReferToSameLocation("/c/Users/521523/Contacts", "C:\\Users\\521523\\Contacts"),
    true,
  );
  assert.equal(
    windowsUserPathsReferToSameLocation("/c/Users/a", "/C:/Users/b"),
    false,
  );
  assert.equal(
    windowsUserPathsReferToSameLocation("/home/user", "/home/user"),
    true,
  );
  assert.equal(
    windowsUserPathsReferToSameLocation("/home/user", "/c/home/user"),
    false,
  );
});
