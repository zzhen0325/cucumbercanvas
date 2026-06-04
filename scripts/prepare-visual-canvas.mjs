#!/usr/bin/env node

const DEFAULT_SERVER_BASE_URL = "http://localhost:3001";
const DEFAULT_WEB_BASE_URL = "http://localhost:3000";
const DEFAULT_ACCESS_TOKEN = "dev-skip-auth-token";
const DEFAULT_PROJECT_NAME = "Visual Acceptance Fixture";

class HttpRequestError extends Error {
  constructor({ body, context, message, status, url }) {
    super(message);
    this.body = body;
    this.context = context;
    this.status = status;
    this.url = url;
  }
}

const options = parseArgs(process.argv.slice(2));
const serverBaseUrl = normalizeBaseUrl(
  options.server ??
    process.env.CUCUMBER_SERVER_BASE_URL ??
    process.env.NEXT_PUBLIC_CUCUMBER_SERVER_BASE_URL ??
    DEFAULT_SERVER_BASE_URL,
);
const webBaseUrl = normalizeBaseUrl(
  options.web ?? process.env.CUCUMBER_WEB_BASE_URL ?? DEFAULT_WEB_BASE_URL,
);
const accessToken =
  options.token ??
  process.env.CUCUMBER_VISUAL_ACCEPTANCE_TOKEN ??
  process.env.CUCUMBER_DEV_ACCESS_TOKEN ??
  DEFAULT_ACCESS_TOKEN;
const projectName =
  options.name ??
  process.env.CUCUMBER_VISUAL_ACCEPTANCE_PROJECT_NAME ??
  DEFAULT_PROJECT_NAME;

try {
  const fixture = await ensureVisualCanvasFixture({
    accessToken,
    projectName,
    serverBaseUrl,
    webBaseUrl,
  });
  if (options.json) {
    console.log(JSON.stringify(fixture, null, 2));
  } else {
    console.log(`[visual-canvas] projectId=${fixture.projectId}`);
    console.log(`[visual-canvas] canvasId=${fixture.canvasId}`);
    console.log(`[visual-canvas] url=${fixture.url}`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[visual-canvas] failed: ${message}`);
  process.exitCode = 1;
}

async function ensureVisualCanvasFixture({
  accessToken,
  projectName,
  serverBaseUrl,
  webBaseUrl,
}) {
  await requestJson(`${serverBaseUrl}/api/viewer`, {
    accessToken,
    context: "ensure viewer foundation",
  });

  const existingProject = await findExistingFixtureProject({
    accessToken,
    projectName,
    serverBaseUrl,
  });
  const project = existingProject
    ? existingProject
    : await createVisualFixtureProject({
        accessToken,
        projectName,
        serverBaseUrl,
      });

  if (!project?.id || !project?.primaryCanvas?.id) {
    throw new Error(
      "Project API did not return project.id and project.primaryCanvas.id.",
    );
  }

  const canvasId = project.primaryCanvas.id;
  await requestJson(`${serverBaseUrl}/api/canvases/${canvasId}`, {
    accessToken,
    context: `verify visual acceptance canvas ${canvasId}`,
  });

  return {
    canvasId,
    projectId: project.id,
    projectName: project.name,
    reused: Boolean(existingProject),
    url: `${webBaseUrl}/canvas?id=${encodeURIComponent(canvasId)}`,
  };
}

async function findExistingFixtureProject({
  accessToken,
  projectName,
  serverBaseUrl,
}) {
  try {
    const projectsBody = await requestJson(`${serverBaseUrl}/api/projects`, {
      accessToken,
      context: "list existing projects",
    });
    const projects = Array.isArray(projectsBody.projects)
      ? projectsBody.projects
      : [];
    return projects.find(
      (project) =>
        project &&
        project.name === projectName &&
        project.primaryCanvas &&
        typeof project.primaryCanvas.id === "string",
    );
  } catch (error) {
    if (error instanceof HttpRequestError && error.status === 500) {
      console.warn(
        `[visual-canvas] existing project lookup failed (${error.message}); creating a fresh fixture through /api/projects instead.`,
      );
      return null;
    }
    throw error;
  }
}

async function createVisualFixtureProject({
  accessToken,
  projectName,
  serverBaseUrl,
}) {
  let body;
  try {
    body = await requestJson(`${serverBaseUrl}/api/projects`, {
      accessToken,
      body: { name: projectName },
      context: "create visual acceptance fixture project",
      method: "POST",
    });
  } catch (error) {
    if (
      error instanceof HttpRequestError &&
      error.status === 500 &&
      accessToken === DEFAULT_ACCESS_TOKEN
    ) {
      throw new Error(
        `${error.message} The default dev-skip-auth token can authenticate local API requests, but this server still cannot create a Supabase-backed project for that mock user. Log in once and rerun with CUCUMBER_VISUAL_ACCEPTANCE_TOKEN set to the browser session access token.`,
      );
    }
    throw error;
  }
  return body.project;
}

async function requestJson(url, options) {
  const headers = {
    Authorization: `Bearer ${options.accessToken}`,
  };
  if (options.body) {
    headers["content-type"] = "application/json";
  }

  let response;
  try {
    response = await fetch(url, {
      body: options.body ? JSON.stringify(options.body) : undefined,
      headers,
      method: options.method ?? "GET",
    });
  } catch (error) {
    throw new Error(
      `${options.context} request could not reach ${url}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const text = await response.text();
  const body = text ? parseJson(text, options.context) : {};
  if (!response.ok) {
    const bodyMessage =
      body?.error?.message ?? body?.message ?? JSON.stringify(body);
    const normalizedBodyMessage = String(bodyMessage).replace(/[.。]+$/, "");
    if (response.status === 401) {
      throw new HttpRequestError({
        body,
        context: options.context,
        message: `${options.context} failed with HTTP 401: ${normalizedBodyMessage}. Set CUCUMBER_VISUAL_ACCEPTANCE_TOKEN to a valid session token, or run the local stack with CUCUMBER_DEV_SKIP_AUTH=true and NEXT_PUBLIC_DEV_SKIP_AUTH=true.`,
        status: response.status,
        url,
      });
    }
    throw new HttpRequestError({
      body,
      context: options.context,
      message: `${options.context} failed with HTTP ${response.status}: ${normalizedBodyMessage}.`,
      status: response.status,
      url,
    });
  }
  return body;
}

function parseJson(text, context) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${context} returned a non-JSON response: ${text}`);
  }
}

function normalizeBaseUrl(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Base URL cannot be empty.");
  }
  return trimmed.replace(/\/+$/, "");
}

function parseArgs(args) {
  const parsed = {
    json: false,
    name: undefined,
    server: undefined,
    token: undefined,
    web: undefined,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelpAndExit();
    }
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${arg}.`);
    }
    if (arg === "--name") parsed.name = next;
    else if (arg === "--server") parsed.server = next;
    else if (arg === "--token") parsed.token = next;
    else if (arg === "--web") parsed.web = next;
    else throw new Error(`Unknown option: ${arg}`);
    index += 1;
  }
  return parsed;
}

function printHelpAndExit() {
  console.log(`Prepare a real local canvas for Browser visual acceptance.

Usage:
  pnpm prepare:visual-canvas
  pnpm prepare:visual-canvas -- --json

Options:
  --server <url>  API server base URL. Defaults to ${DEFAULT_SERVER_BASE_URL}
  --web <url>     Web app base URL. Defaults to ${DEFAULT_WEB_BASE_URL}
  --token <jwt>   Bearer token. Defaults to the dev-skip-auth token.
  --name <name>   Fixture project name. Defaults to "${DEFAULT_PROJECT_NAME}"
  --json          Print machine-readable output.

Environment:
  CUCUMBER_VISUAL_ACCEPTANCE_TOKEN can provide a real logged-in session token.
  The default token works only when the local stack enables dev skip auth.
`);
  process.exit(0);
}
