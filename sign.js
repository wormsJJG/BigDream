"use strict";

const { execSync } = require("child_process");
const path = require("path");

const CERT_SHA1 = "6EC321983C72948150D5F455D38FF5F2A1F7F553";
const TSA = "http://timestamp.digicert.com";
const SIGNTOOL = `"${process.env.LOCALAPPDATA}\\electron-builder\\Cache\\winCodeSign\\winCodeSign-2.6.0\\windows-10\\x64\\signtool.exe"`;

const SKIP_SEGMENTS = [
  `${path.sep}ios-tools${path.sep}`,
  `${path.sep}platform-tools${path.sep}`,
];

exports.default = async function sign(configuration) {
  const filePath = configuration.path;

  if (SKIP_SEGMENTS.some((seg) => filePath.includes(seg))) {
    console.log(`[sign] SKIP  ${filePath}`);
    return;
  }

  const cmd = [
    `${SIGNTOOL} sign`,
    `/sha1 ${CERT_SHA1}`,
    `/s My`,
    `/fd sha256`,
    `/td sha256`,
    `/tr ${TSA}`,
    `/d "BD-Scanner"`,
    `"${filePath}"`,
  ].join(" ");

  console.log(`[sign] SIGN  ${filePath}`);
  execSync(cmd, { stdio: "inherit" });
};
