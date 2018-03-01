/* global TestPilotGA */

const USER_AGENT = "Mozilla/5.0 (Android 4.4; Mobile; rv:41.0) Gecko/41.0 Firefox/41.0";
// iOS:
//   Mozilla/5.0 (iPhone; CPU iPhone OS 9_2 like Mac OS X) AppleWebKit/601.1 (KHTML, like Gecko) CriOS/47.0.2526.70 Mobile/13C71 Safari/601.1.46
// Firefox for Android:
//   Mozilla/5.0 (Android 4.4; Mobile; rv:41.0) Gecko/41.0 Firefox/41.0
// Chrome for Android:
//   Mozilla/5.0 (Linux; Android 4.0.4; Galaxy Nexus Build/IMM76B) AppleWebKit/535.19 (KHTML, like Gecko) Chrome/18.0.1025.133 Mobile Safari/535.19

const manifest = browser.runtime.getManifest();

const ga = new TestPilotGA({
  an: "tab-split-2",
  aid: manifest.applications.gecko.id,
  aiid: "testpilot",
  av: manifest.version,
  cd19: "dev", // could be: local, dev, stage, or production
  ds: "addon",
  tid: "", // production value is "UA-77033033-7"
});

function sendEvent(...args) {
  ga.sendEvent(...args);
}

sendEvent("startup", "startup", {ni: true});

browser.contextMenus.create({
  id: "open-in-sidebar",
  title: "Open in sidebar",
  contexts: ["page", "tab"],
  documentUrlPatterns: ["<all_urls>"]
});

browser.contextMenus.create({
  id: "open-link-in-sidebar",
  title: "Open link in sidebar",
  // FIXME: could add "bookmark", but have to fetch by info.bookmarkId
  contexts: ["link"],
  documentUrlPatterns: ["<all_urls>"]
});

browser.contextMenus.onClicked.addListener((info, tab) => {
  let url = info.linkUrl || tab.url;
  if (info.linkUrl) {
    sendEvent("browse", "context-menu-link");
  } else {
    // FIXME: should distinguish between clicking in the page, and on the tab:
    sendEvent("browse", "context-menu-page");
  }
  // FIXME: should send something in the event about whether the sidebar is already open
  // FIXME: should send something in the event about whether tab.id === -1 (probably from the sidebar itself)
  browser.sidebarAction.open().then(() => {
    return browser.windows.getCurrent();
  }).then((windowInfo) => {
    // FIXME: should send something in an event about whether the desktop has already been set
    let desktop = !!desktopHostnames[(new URL(url)).hostname];
    let message = {type: "browse", url, windowId: windowInfo.id, desktop};
    return retry(() => {
      return browser.runtime.sendMessage(message);
    }, {times: 3, wait: 50});
  }).catch((error) => {
    console.error("Error setting panel to page:", error);
  });
});

browser.runtime.onMessage.addListener((message) => {
  if (message.type == "setDesktop") {
    setDesktop(message.desktop, message.url);
  } else if (message.type == "sendEvent") {
    ga.sendEvent(message.ec, message.ea, message.eventParams);
  } else {
    console.error("Unexpected message to background:", message);
  }
});

// This is a RequestFilter: https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/webRequest/RequestFilter
// It matches tabs that aren't attached to a normal location (like a sidebar)
// It only matches embedded iframes
let requestFilter = {
  tabId: -1,
  types: ["sub_frame"],
  urls: ["http://*/*", "https://*/*"],
};

let desktopHostnames = {};

browser.storage.sync.get("desktopHostnames").then((result) => {
  desktopHostnames = result.desktopHostnames || {};
}).catch((error) => {
  console.error("Error retrieving desktopHostnames:", error);
});

function setDesktop(desktop, url) {
  let hostname = (new URL(url)).hostname;
  if (desktop) {
    desktopHostnames[hostname] = true;
  } else {
    delete desktopHostnames[hostname];
  }
  browser.storage.sync.set({desktopHostnames}).catch((error) => {
    console.error("Error setting desktopHostnames:", desktopHostnames);
  });
  return Promise.resolve();
}

// Add a mobile header to outgoing requests
browser.webRequest.onBeforeSendHeaders.addListener(function (info) {
  let hostname = (new URL(info.url)).hostname;
  if (desktopHostnames[hostname]) {
    return {};
  }
  let headers = info.requestHeaders;
  for (let i = 0; i < headers.length; i++) {
    let name = headers[i].name.toLowerCase();
    if (name === "user-agent") {
      headers[i].value = USER_AGENT;
      return {"requestHeaders": headers};
    }
  }
  return {};
}, requestFilter, ["blocking", "requestHeaders"]);

// Remove X-Frame-Options to allow any page to be embedded in an iframe
chrome.webRequest.onHeadersReceived.addListener(function (info) {
  let headers = info.responseHeaders;
  for (let i = 0; i < headers.length; i++) {
    let name = headers[i].name.toLowerCase();
    if (name === "x-frame-options" || name === "frame-options") {
      headers.splice(i, 1);
      return {"responseHeaders": headers};
    }
  }
  return {};
}, requestFilter, ["blocking", "responseHeaders"]);

function retry(attempter, options) {
  let times = options.times || 3;
  let wait = options.wait || 100;
  return attempter().catch((error) => {
    times--;
    if (times <= 0) {
      throw error;
    }
    return timeout(wait).then(() => {
      retry(attempter, {times, wait});
    });
  });
}

function timeout(time) {
  return new Promise((resolve) => {
    setTimeout(resolve, time);
  });
}
