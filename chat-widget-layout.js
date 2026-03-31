(function () {
  var MOBILE_BREAKPOINT = 720;
  var body = document.body;
  var scheduledUpdate = null;

  function allElements(rootNode, acc) {
    var nodes = rootNode.querySelectorAll("*");
    for (var i = 0; i < nodes.length; i += 1) {
      var node = nodes[i];
      acc.push(node);
      if (node.shadowRoot) {
        allElements(node.shadowRoot, acc);
      }
    }
  }

  function isWidgetNode(node) {
    var text = [
      node.id,
      node.className,
      node.getAttribute && node.getAttribute("title"),
      node.getAttribute && node.getAttribute("name"),
      node.getAttribute && node.getAttribute("src"),
      node.getAttribute && node.getAttribute("data-testid"),
    ].join(" ").toLowerCase();

    if (text.indexOf("m8com") !== -1 || text.indexOf("contactwidget") !== -1) {
      return true;
    }

    if (node.tagName === "IFRAME") {
      var rect = node.getBoundingClientRect();
      var style = window.getComputedStyle(node);
      return style.position === "fixed" && rect.width > 56 && rect.height > 56;
    }

    return false;
  }

  function rememberInlineStyle(node, prop) {
    var key = "team8Original" + prop.charAt(0).toUpperCase() + prop.slice(1);
    if (!node.dataset[key]) {
      node.dataset[key] = node.style.getPropertyValue(prop) || "";
    }
  }

  function setStyle(node, prop, value) {
    rememberInlineStyle(node, prop);
    node.style.setProperty(prop, value, "important");
  }

  function restoreStyle(node, prop) {
    var key = "team8Original" + prop.charAt(0).toUpperCase() + prop.slice(1);
    node.style.removeProperty(prop);
    if (node.dataset[key]) {
      node.style.setProperty(prop, node.dataset[key]);
    }
  }

  function updateWidgetLayout() {
    var isMobile = window.innerWidth <= MOBILE_BREAKPOINT;
    var nodes = [];

    if (body) {
      body.classList.toggle("has-chat-widget", isMobile);
    }

    allElements(document, nodes);

    for (var i = 0; i < nodes.length; i += 1) {
      var node = nodes[i];
      if (!isWidgetNode(node)) {
        continue;
      }

      if (isMobile) {
        setStyle(node, "right", "12px");
        setStyle(node, "left", "auto");
        setStyle(node, "bottom", "calc(env(safe-area-inset-bottom, 0px) + 12px)");
        setStyle(node, "max-width", "calc(100vw - 24px)");
        setStyle(node, "max-height", "calc(100vh - 96px)");
        setStyle(node, "border-radius", "18px");
      } else {
        restoreStyle(node, "right");
        restoreStyle(node, "left");
        restoreStyle(node, "bottom");
        restoreStyle(node, "max-width");
        restoreStyle(node, "max-height");
        restoreStyle(node, "border-radius");
      }
    }
  }

  function scheduleUpdate() {
    if (scheduledUpdate) {
      window.clearTimeout(scheduledUpdate);
    }

    scheduledUpdate = window.setTimeout(function () {
      scheduledUpdate = null;
      updateWidgetLayout();
    }, 120);
  }

  window.addEventListener("load", function () {
    updateWidgetLayout();
    window.setTimeout(updateWidgetLayout, 1200);
    window.setTimeout(updateWidgetLayout, 2600);

    if (window.MutationObserver) {
      var observer = new MutationObserver(scheduleUpdate);
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
      });
    }
  });

  window.addEventListener("resize", scheduleUpdate);
})();
