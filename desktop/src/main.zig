//! VELTRIX Wallet — desktop launcher.
//!
//! The app itself is the production web bundle (`app/dist`, built by Vite). This
//! executable embeds that bundle, serves it over **127.0.0.1 only**, and opens it
//! in a Chromium "app mode" window (Edge → Chrome → Brave). Nothing is written to
//! disk by this launcher, no interface other than loopback is ever bound, and no
//! request ever leaves the machine: the bundle is served from read-only memory.
//!
//! The port is fixed (`DEFAULT_PORT`) rather than ephemeral so that the origin —
//! and therefore the `localStorage` the wallet keeps its ledger in — is identical
//! on every launch. If the port is already held, we check `/__veltrix/ping`: if
//! it is another VELTRIX instance we simply open a second window onto it, and if
//! it is some unrelated program we fall back to the next few ports.
//!
//! Build: see `tools/build-exe.sh`. `assets.zig` is generated next to a copy of
//! this file by that script, which is why the import below is a plain relative one.

const std = @import("std");
const builtin = @import("builtin");
const net = std.net;
const assets = @import("assets.zig");

const Allocator = std.mem.Allocator;

pub const APP_NAME = "VELTRIX Wallet";
pub const APP_VERSION = "1.0.0";
pub const APP_ID = "com.veltrix.wallet";

/// Fixed on purpose: the origin backs the app's localStorage. See header.
const DEFAULT_PORT: u16 = 43921;
/// Probed when the fixed port is taken by something that is *not* VELTRIX.
const PORT_FALLBACKS: u16 = 8;

const PING_PATH = "/__veltrix/ping";
const MAX_LINE = 8 * 1024;
const MAX_HEADER_LINES = 64;
const WRITE_BUF = 16 * 1024;

const is_windows = builtin.os.tag == .windows;

extern "user32" fn MessageBoxW(
    hwnd: ?*anyopaque,
    text: [*:0]const u16,
    caption: [*:0]const u16,
    utype: u32,
) i32;

const MB_ICONERROR = 0x10;
const MB_ICONWARNING = 0x30;

// ---------------------------------------------------------------------------
// Output: stderr on a console target, a dialog on the GUI (Windows) build.
// ---------------------------------------------------------------------------

fn notify(level: []const u8, comptime fmt: []const u8, args: anytype) void {
    var buf: [1024]u8 = undefined;
    const msg = std.fmt.bufPrint(&buf, fmt, args) catch fmt;
    std.io.getStdErr().writer().print("{s}: {s}\n", .{ level, msg }) catch {};
    if (!is_windows) return;

    const heap = std.heap.page_allocator;
    const wtext = std.unicode.utf8ToUtf16LeAllocZ(heap, msg) catch return;
    defer heap.free(wtext);
    const wtitle = std.unicode.utf8ToUtf16LeAllocZ(heap, APP_NAME) catch return;
    defer heap.free(wtitle);
    const icon: u32 = if (std.mem.eql(u8, level, "error")) MB_ICONERROR else MB_ICONWARNING;
    _ = MessageBoxW(null, wtext.ptr, wtitle.ptr, icon);
}

fn fatal(comptime fmt: []const u8, args: anytype) noreturn {
    notify("error", fmt, args);
    std.process.exit(1);
}

// ---------------------------------------------------------------------------
// HTTP: one connection per thread, `Connection: close`, loopback only.
// ---------------------------------------------------------------------------

const Response = struct {
    status: u16,
    reason: []const u8,
    mime: []const u8,
    body: []const u8,
    /// Hashed build artefacts carry a content hash in their name → cache forever.
    cacheable: bool = false,
};

const NOT_FOUND_BODY =
    \\<!doctype html><meta charset="utf-8"><title>404 — VELTRIX Wallet</title>
    \\<body style="font:15px/1.5 system-ui,sans-serif;background:#07090d;color:#e5e7eb;padding:32px">
    \\<h1 style="font-size:20px">Not found</h1>
    \\<p>VELTRIX serves its interface from a fixed set of embedded files.</p>
;

const BAD_REQUEST_BODY =
    \\<!doctype html><meta charset="utf-8"><title>400 — VELTRIX Wallet</title>
    \\<body style="font:15px/1.5 system-ui,sans-serif;background:#07090d;color:#e5e7eb;padding:32px">
    \\<h1 style="font-size:20px">Bad request</h1>
;

fn errorResponse(status: u16, reason: []const u8, mime: []const u8, body: []const u8) Response {
    return .{ .status = status, .reason = reason, .mime = mime, .body = body };
}

fn percentDecode(alloc: Allocator, in: []const u8) ![]const u8 {
    const out = try alloc.alloc(u8, in.len);
    var n: usize = 0;
    var i: usize = 0;
    while (i < in.len) {
        if (in[i] == '%' and i + 2 < in.len) {
            const hi = std.fmt.charToDigit(in[i + 1], 16) catch {
                out[n] = in[i];
                n += 1;
                i += 1;
                continue;
            };
            const lo = std.fmt.charToDigit(in[i + 2], 16) catch {
                out[n] = in[i];
                n += 1;
                i += 1;
                continue;
            };
            out[n] = @intCast(hi * 16 + lo);
            n += 1;
            i += 3;
            continue;
        }
        out[n] = in[i];
        n += 1;
        i += 1;
    }
    return out[0..n];
}

fn indexResponse() Response {
    const index = assets.find("/index.html") orelse @panic("bundle has no index.html");
    return .{ .status = 200, .reason = "OK", .mime = index.mime, .body = index.bytes };
}

/// Resolve a request path to a bundled asset. Unknown extension-less paths fall
/// through to `index.html` so the SPA's `history.pushState` routes survive a
/// reload; paths that look like files (have an extension) 404 instead.
fn resolve(alloc: Allocator, target: []const u8) !Response {
    if (std.mem.eql(u8, target, PING_PATH)) {
        return errorResponse(200, "OK", "text/plain; charset=utf-8", APP_VERSION);
    }

    var path = target;
    if (std.mem.indexOfScalar(u8, path, '?')) |q| path = path[0..q];
    if (std.mem.indexOfScalar(u8, path, '#')) |h| path = path[0..h];
    path = try percentDecode(alloc, path);

    const bad = errorResponse(400, "Bad Request", "text/html; charset=utf-8", BAD_REQUEST_BODY);
    if (path.len == 0 or path[0] != '/') return bad;
    if (std.mem.indexOf(u8, path, "..") != null) return bad;
    if (std.mem.indexOfScalar(u8, path, 0) != null) return bad;

    if (std.mem.eql(u8, path, "/") or std.mem.eql(u8, path, "/index.html")) return indexResponse();

    if (assets.find(path)) |a| {
        return .{
            .status = 200,
            .reason = "OK",
            .mime = a.mime,
            .body = a.bytes,
            .cacheable = std.mem.startsWith(u8, path, "/assets/"),
        };
    }

    // Extension-less → client-side route. Anything else is a genuine miss.
    const tail = if (std.mem.lastIndexOfScalar(u8, path, '/')) |s| path[s + 1 ..] else path[1..];
    if (std.mem.indexOfScalar(u8, tail, '.') == null) return indexResponse();

    return errorResponse(404, "Not Found", "text/html; charset=utf-8", NOT_FOUND_BODY);
}

fn writeResponse(stream: net.Stream, res: Response, head_only: bool) !void {
    var bw = std.io.BufferedWriter(WRITE_BUF, net.Stream.Writer){ .unbuffered_writer = stream.writer() };
    const w = bw.writer();

    try w.print("HTTP/1.1 {d} {s}\r\n", .{ res.status, res.reason });
    try w.print("Content-Type: {s}\r\n", .{res.mime});
    try w.print("Content-Length: {d}\r\n", .{res.body.len});
    if (res.cacheable) {
        try w.writeAll("Cache-Control: public, max-age=31536000, immutable\r\n");
    } else {
        try w.writeAll("Cache-Control: no-cache\r\n");
    }
    try w.writeAll("X-Content-Type-Options: nosniff\r\n");
    try w.writeAll("Referrer-Policy: no-referrer\r\n");
    try w.print("X-Veltrix-Ping: {s}\r\n", .{APP_VERSION});
    try w.writeAll("Connection: close\r\n\r\n");
    if (!head_only) try w.writeAll(res.body);
    try bw.flush();
}

fn handle(stream: net.Stream, alloc: Allocator) void {
    defer stream.close();

    var br = std.io.BufferedReader(MAX_LINE, std.net.Stream.Reader){ .unbuffered_reader = stream.reader() };
    const r = br.reader();

    var line_buf: [MAX_LINE]u8 = undefined;
    const line = (r.readUntilDelimiterOrEof(&line_buf, '\n') catch null) orelse return;

    var it = std.mem.tokenizeAny(u8, line, " \t\r\n");
    const method = it.next() orelse return;
    const target = it.next() orelse return;

    // Drain the header block. Nothing in it is needed, but leaving it unread
    // would be rude to a client that pipelines.
    var hbuf: [MAX_LINE]u8 = undefined;
    var lines: usize = 0;
    while (lines < MAX_HEADER_LINES) : (lines += 1) {
        const h = (r.readUntilDelimiterOrEof(&hbuf, '\n') catch null) orelse break;
        const t = std.mem.trimRight(u8, h, "\r");
        if (t.len == 0) break;
    }

    const head_only = std.ascii.eqlIgnoreCase(method, "HEAD");
    const res = if (!head_only and !std.ascii.eqlIgnoreCase(method, "GET"))
        errorResponse(405, "Method Not Allowed", "text/plain; charset=utf-8", "method not allowed")
    else
        resolve(alloc, target) catch errorResponse(500, "Internal Server Error", "text/plain; charset=utf-8", "error");

    writeResponse(stream, res, head_only) catch {};
}

fn acceptLoop(server: *net.Server) void {
    while (true) {
        const conn = server.accept() catch |err| switch (err) {
            error.ConnectionAborted => continue,
            else => return,
        };
        const thread = std.Thread.spawn(.{}, struct {
            fn run(s: net.Stream) void {
                var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
                defer arena.deinit();
                handle(s, arena.allocator());
            }
        }.run, .{conn.stream}) catch {
            conn.stream.close();
            continue;
        };
        thread.detach();
    }
}

// ---------------------------------------------------------------------------
// Port selection / single-instance detection
// ---------------------------------------------------------------------------

const Bind = struct {
    server: net.Server,
    port: u16,
    /// False when an existing VELTRIX instance already serves this port.
    owned: bool,
};

fn tryBind(port: u16) ?Bind {
    const posix = std.posix;
    const addr = net.Address.initIp4(.{ 127, 0, 0, 1 }, port);

    const fd = posix.socket(
        posix.AF.INET,
        posix.SOCK.STREAM | posix.SOCK.CLOEXEC,
        posix.IPPROTO.TCP,
    ) catch return null;

    // Set SO_REUSEADDR by hand rather than passing `reuse_address` to
    // `net.Address.listen`: that helper sets SO_REUSEPORT too (net.zig), and
    // SO_REUSEPORT lets two *live* launchers share one port — which silently
    // breaks the single-instance detection below. SO_REUSEADDR alone only lets
    // us rebind over our own TIME_WAIT sockets after a restart.
    const on = std.mem.toBytes(@as(c_int, 1));
    posix.setsockopt(fd, posix.SOL.SOCKET, posix.SO.REUSEADDR, &on) catch {
        posix.close(fd);
        return null;
    };
    posix.bind(fd, &addr.any, addr.getOsSockLen()) catch {
        posix.close(fd);
        return null;
    };
    posix.listen(fd, 128) catch {
        posix.close(fd);
        return null;
    };

    return .{
        .server = .{ .listen_address = addr, .stream = .{ .handle = fd } },
        .port = port,
        .owned = true,
    };
}

/// Ask whoever holds the port whether they are us.
fn isVeltrixAlreadyServing(port: u16) bool {
    const addr = net.Address.initIp4(.{ 127, 0, 0, 1 }, port);
    const stream = net.tcpConnectToAddress(addr) catch return false;
    defer stream.close();

    var w = stream.writer();
    w.print("GET {s} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n", .{PING_PATH}) catch return false;

    var buf: [512]u8 = undefined;
    const n = stream.reader().readAll(&buf) catch return false;
    const head = buf[0..n];
    return std.mem.startsWith(u8, head, "HTTP/1.1 200") and
        std.mem.indexOf(u8, head, "X-Veltrix-Ping:") != null;
}

fn acquirePort() Bind {
    if (tryBind(DEFAULT_PORT)) |b| return b;
    if (isVeltrixAlreadyServing(DEFAULT_PORT)) {
        return .{ .server = undefined, .port = DEFAULT_PORT, .owned = false };
    }
    var port: u32 = @as(u32, DEFAULT_PORT) + 1;
    while (port < @as(u32, DEFAULT_PORT) + PORT_FALLBACKS) : (port += 1) {
        if (tryBind(@intCast(port))) |b| return b;
    }
    fatal("could not bind 127.0.0.1:{d}; another program is using the port", .{DEFAULT_PORT});
}

// ---------------------------------------------------------------------------
// Browser discovery + app-mode window
// ---------------------------------------------------------------------------

/// `std.posix.getenv` is compile-time-unavailable on Windows (its environment
/// block is WTF-16), so go through the allocating, cross-platform API. The
/// arena owns the result for the process lifetime.
fn getEnv(alloc: Allocator, name: []const u8) ?[]const u8 {
    return std.process.getEnvVarOwned(alloc, name) catch null;
}

const WinCandidate = struct { env: []const u8, rel: []const u8 };

const win_candidates = [_]WinCandidate{
    .{ .env = "ProgramFiles(x86)", .rel = "Microsoft/Edge/Application/msedge.exe" },
    .{ .env = "ProgramFiles", .rel = "Microsoft/Edge/Application/msedge.exe" },
    .{ .env = "LocalAppData", .rel = "Microsoft/Edge/Application/msedge.exe" },
    .{ .env = "ProgramFiles", .rel = "Google/Chrome/Application/chrome.exe" },
    .{ .env = "ProgramFiles(x86)", .rel = "Google/Chrome/Application/chrome.exe" },
    .{ .env = "LocalAppData", .rel = "Google/Chrome/Application/chrome.exe" },
    .{ .env = "ProgramFiles", .rel = "BraveSoftware/Brave-Browser/Application/brave.exe" },
};

const posix_candidates = [_][]const u8{
    "microsoft-edge",
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
};

fn findBrowserOnPath(alloc: Allocator, name: []const u8) ?[]const u8 {
    var it = std.mem.splitScalar(u8, getEnv(alloc, "PATH") orelse return null, std.fs.path.delimiter);
    while (it.next()) |dir| {
        if (dir.len == 0) continue;
        const cand = std.fs.path.join(alloc, &.{ dir, name }) catch continue;
        std.fs.cwd().access(cand, .{}) catch continue;
        return cand;
    }
    return null;
}

fn findBrowser(alloc: Allocator) ?[]const u8 {
    if (is_windows) {
        for (win_candidates) |c| {
            const root = getEnv(alloc, c.env) orelse continue;
            const full = std.fs.path.join(alloc, &.{ root, c.rel }) catch continue;
            std.fs.cwd().access(full, .{}) catch continue;
            return full;
        }
        return null;
    }
    for (posix_candidates) |name| {
        if (findBrowserOnPath(alloc, name)) |p| return p;
    }
    return null;
}

fn profileDir(alloc: Allocator) ?[]const u8 {
    if (is_windows) {
        const root = getEnv(alloc, "LocalAppData") orelse return null;
        return std.fs.path.join(alloc, &.{ root, "VELTRIX Wallet", "profile" }) catch null;
    }
    const root = getEnv(alloc, "XDG_CONFIG_HOME") orelse blk: {
        const home = getEnv(alloc, "HOME") orelse return null;
        break :blk std.fs.path.join(alloc, &.{ home, ".config" }) catch return null;
    };
    return std.fs.path.join(alloc, &.{ root, "veltrix-wallet", "profile" }) catch null;
}

/// Open the bundle in a chromeless "app mode" window and block until it closes.
fn openAppWindow(alloc: Allocator, url: []const u8) void {
    const browser = findBrowser(alloc) orelse {
        notify(
            "error",
            "VELTRIX needs Microsoft Edge or Google Chrome to draw its interface.\n\n" ++
                "Neither was found. Install one, then start VELTRIX again.\n(The app is listening at {s})",
            .{url},
        );
        std.process.exit(1);
    };

    var argv = std.ArrayList([]const u8).init(alloc);
    argv.append(browser) catch return;
    argv.append(allocPrint(alloc, "--app={s}", .{url})) catch return;
    argv.append("--window-size=420,880") catch return;
    argv.append("--no-first-run") catch return;
    argv.append("--no-default-browser-check") catch return;
    argv.append("--disable-session-crashed-bubble") catch return;
    if (profileDir(alloc)) |p| {
        argv.append(allocPrint(alloc, "--user-data-dir={s}", .{p})) catch return;
    }

    var child = std.process.Child.init(argv.items, alloc);
    child.stdin_behavior = .Ignore;
    child.stdout_behavior = .Ignore;
    child.stderr_behavior = .Ignore;
    child.spawn() catch |err| {
        notify("error", "could not start {s}: {s}", .{ browser, @errorName(err) });
        std.process.exit(1);
    };
    _ = child.wait() catch {};
}

fn allocPrint(alloc: Allocator, comptime fmt: []const u8, args: anytype) []const u8 {
    return std.fmt.allocPrint(alloc, fmt, args) catch "";
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const Options = struct {
    port: u16 = 0, // 0 = use DEFAULT_PORT with fallback probing
    serve_only: bool = false,
    print_url: bool = false,
};

fn usage() noreturn {
    std.io.getStdOut().writer().writeAll(
        \\VELTRIX Wallet 1.0.0 — desktop launcher (a simulator; no real money)
        \\
        \\Usage: VELTRIX-Wallet.exe [options]
        \\
        \\  --serve-only   Run the local server and do not open a window
        \\  --print-url    Print the URL and keep running (implies --serve-only)
        \\  --port <n>     Listen on 127.0.0.1:<n> instead of 43921
        \\  --version      Print the version and exit
        \\  --help         This text
        \\
        \\The interface is served from 127.0.0.1 only. No data leaves this machine.
        \\
    ) catch {};
    std.process.exit(0);
}

fn parseArgs(alloc: Allocator) Options {
    var o = Options{};
    const argv = std.process.argsAlloc(alloc) catch return o;
    var i: usize = 1;
    while (i < argv.len) : (i += 1) {
        const a = argv[i];
        if (std.mem.eql(u8, a, "--serve-only")) {
            o.serve_only = true;
        } else if (std.mem.eql(u8, a, "--print-url")) {
            o.print_url = true;
            o.serve_only = true;
        } else if (std.mem.eql(u8, a, "--version")) {
            std.io.getStdOut().writer().print("{s} {s}\n", .{ APP_NAME, APP_VERSION }) catch {};
            std.process.exit(0);
        } else if (std.mem.eql(u8, a, "--help") or std.mem.eql(u8, a, "-h")) {
            usage();
        } else if (std.mem.eql(u8, a, "--port")) {
            i += 1;
            if (i >= argv.len) fatal("--port needs a value", .{});
            o.port = std.fmt.parseInt(u16, argv[i], 10) catch
                fatal("invalid --port value: {s}", .{argv[i]});
        }
    }
    return o;
}

pub fn main() !void {
    var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
    defer arena.deinit();
    const alloc = arena.allocator();

    const opts = parseArgs(alloc);

    const bind: Bind = if (opts.port != 0)
        tryBind(opts.port) orelse fatal("could not bind 127.0.0.1:{d}", .{opts.port})
    else
        acquirePort();

    var url_buf: [64]u8 = undefined;
    const url = try std.fmt.bufPrint(&url_buf, "http://127.0.0.1:{d}/", .{bind.port});

    if (!bind.owned) {
        // Another VELTRIX instance already serves the bundle — just open a window.
        if (opts.serve_only) {
            fatal("another VELTRIX instance is already listening on 127.0.0.1:{d}", .{bind.port});
        }
        openAppWindow(alloc, url);
        return;
    }

    var server = bind.server;
    const server_thread = try std.Thread.spawn(.{}, acceptLoop, .{&server});

    if (opts.print_url) {
        std.io.getStdOut().writer().print("{s}\n", .{url}) catch {};
    }
    if (opts.serve_only) {
        server_thread.join();
        return;
    }

    openAppWindow(alloc, url);
    std.process.exit(0);
}
