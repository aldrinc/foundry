// Route-based entry (matching Open Code's pattern)
if (location.pathname === "/loading") {
  import("./loading");
} else {
  import("./index");
}
