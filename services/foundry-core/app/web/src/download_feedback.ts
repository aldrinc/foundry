import $ from "jquery";

import * as blueslip from "./blueslip.ts";
import * as feedback_widget from "./feedback_widget.ts";
import {$t} from "./i18n.ts";

const IN_PROGRESS_HIDE_DELAY_MS = 60 * 60 * 1000;
const COMPLETED_HIDE_DELAY_MS = 8000;
const FAILED_HIDE_DELAY_MS = 6000;
const CANCELLED_HIDE_DELAY_MS = 4000;
const OBJECT_URL_TTL_MS = 5 * 60 * 1000;
const MAX_DOWNLOAD_HISTORY_ITEMS = 1000;
const DOWNLOAD_FEEDBACK_CONTAINER_CLASS = "download-feedback-toast";

type DownloadStatus = "in_progress" | "completed" | "failed" | "cancelled";

type DownloadHistoryItem = {
    id: number;
    filename: string;
    download_url: string;
    status: DownloadStatus;
    bytes_downloaded: number;
    bytes_total: number | undefined;
    object_url: string | undefined;
};

let next_download_id = 1;
let active_feedback_download_id: number | undefined;
let is_showing_download_history = false;
const tracked_download_controllers = new Map<number, AbortController>();
const download_history: DownloadHistoryItem[] = [];

function get_primary_action_label(download_item: DownloadHistoryItem): string {
    if (download_item.status === "failed" || download_item.status === "cancelled") {
        return $t({defaultMessage: "Download again"});
    }
    if (download_item.status === "completed" && download_item.object_url === undefined) {
        return $t({defaultMessage: "Download again"});
    }
    return $t({defaultMessage: "Open file"});
}

function sanitize_filename(filename: string): string {
    return filename.replaceAll(/[\\/]/g, "_");
}

function extract_filename_from_content_disposition(
    content_disposition: string | null,
): string | undefined {
    if (content_disposition === null) {
        return undefined;
    }

    const encoded_filename = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(content_disposition)?.[1];
    if (encoded_filename !== undefined) {
        try {
            return sanitize_filename(decodeURIComponent(encoded_filename));
        } catch {
            // Fall back to the plain filename parser below.
        }
    }

    const plain_filename = /filename\s*=\s*"([^"]+)"|filename\s*=\s*([^;]+)/i.exec(
        content_disposition,
    );
    if (plain_filename === null) {
        return undefined;
    }

    const parsed_filename = plain_filename[1] ?? plain_filename[2];
    return parsed_filename === undefined ? undefined : sanitize_filename(parsed_filename.trim());
}

function extract_filename_from_url(download_url: string): string {
    try {
        const url = new URL(download_url, window.location.href);
        const path_segments = url.pathname.split("/").filter((segment) => segment !== "");
        const final_segment = path_segments.at(-1);
        if (final_segment) {
            return sanitize_filename(decodeURIComponent(final_segment));
        }
    } catch {
        // Fall through to the default filename.
    }

    return "downloaded-file";
}

function format_bytes(bytes: number): string {
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = bytes;
    let unit_index = 0;

    while (value >= 1024 && unit_index < units.length - 1) {
        value /= 1024;
        unit_index += 1;
    }

    const decimal_places = value >= 10 || unit_index === 0 ? 0 : 1;
    return `${value.toFixed(decimal_places)} ${units[unit_index]}`;
}

function parse_content_length(content_length: string | null): number | undefined {
    if (content_length === null) {
        return undefined;
    }
    const parsed_length = Number.parseInt(content_length, 10);
    if (!Number.isFinite(parsed_length) || parsed_length <= 0) {
        return undefined;
    }
    return parsed_length;
}

function trim_download_history(): void {
    while (download_history.length > MAX_DOWNLOAD_HISTORY_ITEMS) {
        const removed_item = download_history.pop();
        if (removed_item?.object_url !== undefined) {
            URL.revokeObjectURL(removed_item.object_url);
        }
    }
}

function add_download_history_item({
    filename,
    download_url,
}: {
    filename: string;
    download_url: string;
}): DownloadHistoryItem {
    const download_item: DownloadHistoryItem = {
        id: next_download_id,
        filename,
        download_url,
        status: "in_progress",
        bytes_downloaded: 0,
        bytes_total: undefined,
        object_url: undefined,
    };
    next_download_id += 1;
    download_history.unshift(download_item);
    trim_download_history();
    refresh_visible_download_history();
    return download_item;
}

function get_download_history_item(download_id: number): DownloadHistoryItem | undefined {
    return download_history.find((download_item) => download_item.id === download_id);
}

function is_active_feedback_download(download_id: number): boolean {
    return active_feedback_download_id === download_id;
}

function set_active_feedback_download(download_id: number): void {
    active_feedback_download_id = download_id;
}

function release_tracked_download(download_id: number): void {
    tracked_download_controllers.delete(download_id);
    if (is_active_feedback_download(download_id)) {
        active_feedback_download_id = undefined;
    }
}

function cancel_tracked_download(download_id: number): void {
    tracked_download_controllers.get(download_id)?.abort();
}

function open_downloaded_object_url(object_url: string, filename: string): void {
    const opened_window = window.open(object_url, "_blank", "noopener,noreferrer");
    if (opened_window !== null) {
        return;
    }

    const link = document.createElement("a");
    link.href = object_url;
    link.download = filename;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.style.display = "none";
    document.body.append(link);
    link.click();
    link.remove();
}

function open_download_from_history(download_id: number): void {
    const download_item = get_download_history_item(download_id);
    if (download_item === undefined) {
        return;
    }

    if (download_item.object_url !== undefined) {
        open_downloaded_object_url(download_item.object_url, download_item.filename);
        return;
    }

    start_tracked_download(download_item.download_url, download_item.filename);
}

function refresh_visible_download_history(): void {
    if (!is_showing_download_history || !feedback_widget.is_open()) {
        return;
    }

    const $content = $("#feedback_container .feedback_content");
    if ($content.length === 0) {
        return;
    }
    $content.empty();
    render_download_history($content);
}

function get_download_status_text(download_item: DownloadHistoryItem): string {
    if (download_item.status === "completed") {
        return $t({defaultMessage: "Downloaded"});
    }
    if (download_item.status === "failed") {
        return $t({defaultMessage: "Failed"});
    }
    if (download_item.status === "cancelled") {
        return $t({defaultMessage: "Cancelled"});
    }

    if (download_item.bytes_total !== undefined) {
        return $t(
            {
                defaultMessage: "Downloading {downloaded} of {total}",
            },
            {
                downloaded: format_bytes(download_item.bytes_downloaded),
                total: format_bytes(download_item.bytes_total),
            },
        );
    }

    return $t(
        {
            defaultMessage: "Downloading {downloaded}",
        },
        {
            downloaded: format_bytes(download_item.bytes_downloaded),
        },
    );
}

function render_download_history($container: JQuery): void {
    if (download_history.length === 0) {
        $container.append(
            $("<div>")
                .addClass("download-feedback-status")
                .text($t({defaultMessage: "No downloads yet."})),
        );
        return;
    }

    const $history_list = $("<div>").addClass("download-feedback-history");

    for (const download_item of download_history) {
        const $history_item = $("<div>").addClass("download-feedback-history-item");
        $history_item.append(
            $("<div>").addClass("download-feedback-history-filename").text(download_item.filename),
        );
        $history_item.append(
            $("<div>")
                .addClass("download-feedback-history-meta")
                .text(get_download_status_text(download_item)),
        );

        const $actions = $("<div>").addClass("download-feedback-history-actions");

        if (download_item.status === "in_progress") {
            $actions.append(
                $("<button>")
                    .attr("type", "button")
                    .addClass("download-feedback-action")
                    .text($t({defaultMessage: "Cancel"}))
                    .on("click", () => {
                        cancel_tracked_download(download_item.id);
                    }),
            );
        } else if (
            download_item.status === "completed" ||
            download_item.status === "failed" ||
            download_item.status === "cancelled"
        ) {
            $actions.append(
                $("<button>")
                    .attr("type", "button")
                    .addClass("download-feedback-action")
                    .text(get_primary_action_label(download_item))
                    .on("click", () => {
                        if (
                            download_item.status === "failed" ||
                            download_item.status === "cancelled" ||
                            (download_item.status === "completed" &&
                                download_item.object_url === undefined)
                        ) {
                            start_tracked_download(download_item.download_url, download_item.filename);
                            return;
                        }
                        open_download_from_history(download_item.id);
                    }),
            );
        }

        if ($actions.children().length > 0) {
            $history_item.append($actions);
        }
        $history_list.append($history_item);
    }

    $container.append($history_list);
}

function show_download_history_feedback(): void {
    is_showing_download_history = true;
    feedback_widget.show({
        container_class: DOWNLOAD_FEEDBACK_CONTAINER_CLASS,
        title_text: $t({defaultMessage: "Downloads"}),
        hide_delay: IN_PROGRESS_HIDE_DELAY_MS,
        populate($container) {
            $container.empty();
            render_download_history($container);
        },
    });
}

function get_feedback_progress_bar(): JQuery {
    return $("#feedback_container .download-feedback-progress .bar");
}

function get_feedback_status_text(): JQuery {
    return $("#feedback_container .download-feedback-status");
}

function update_feedback_progress({
    bytes_downloaded,
    bytes_total,
}: {
    bytes_downloaded: number;
    bytes_total: number | undefined;
}): void {
    const $progress_bar = get_feedback_progress_bar();
    const $status = get_feedback_status_text();
    const $progress = $("#feedback_container .download-feedback-progress");

    if (bytes_total !== undefined) {
        const percent_complete = Math.max(
            0,
            Math.min(100, Math.round((100 * bytes_downloaded) / bytes_total)),
        );
        $progress.removeClass("active");
        $progress_bar.css({width: `${percent_complete}%`});
        $status.text(
            $t(
                {
                    defaultMessage: "{downloaded} of {total} ({percent}%)",
                },
                {
                    downloaded: format_bytes(bytes_downloaded),
                    total: format_bytes(bytes_total),
                    percent: `${percent_complete}`,
                },
            ),
        );
        return;
    }

    $progress.addClass("active");
    $progress_bar.css({width: "100%"});
    $status.text(
        $t(
            {
                defaultMessage: "Downloaded {downloaded}…",
            },
            {
                downloaded: format_bytes(bytes_downloaded),
            },
        ),
    );
}

function render_download_actions($container: JQuery, download_id: number): void {
    const download_item = get_download_history_item(download_id);
    const is_download_in_progress = download_item?.status === "in_progress";
    const should_offer_retry =
        download_item?.status === "failed" ||
        download_item?.status === "cancelled" ||
        (download_item?.status === "completed" && download_item.object_url === undefined);

    const $actions = $("<div>").addClass("download-feedback-actions");

    const $primary_action = $("<button>")
        .attr("type", "button")
        .addClass("download-feedback-action")
        .text(should_offer_retry ? $t({defaultMessage: "Download again"}) : $t({defaultMessage: "Open file"}))
        .on("click", () => {
            const latest_download_item = get_download_history_item(download_id);
            if (latest_download_item === undefined) {
                return;
            }

            if (latest_download_item.status === "in_progress") {
                return;
            }

            if (
                latest_download_item.status === "failed" ||
                latest_download_item.status === "cancelled"
            ) {
                start_tracked_download(
                    latest_download_item.download_url,
                    latest_download_item.filename,
                );
                return;
            }

            open_download_from_history(download_id);
        });

    if (is_download_in_progress) {
        $primary_action
            .text($t({defaultMessage: "Downloading…"}))
            .prop("disabled", true)
            .addClass("download-feedback-action-disabled");
    }

    const $view_all_downloads = $("<button>")
        .attr("type", "button")
        .addClass("download-feedback-action")
        .text($t({defaultMessage: "View all downloads"}))
        .on("click", () => {
            show_download_history_feedback();
        });

    $actions.append($primary_action, $view_all_downloads);
    $container.append($actions);
}

function show_download_progress_feedback({
    filename,
    controller,
    download_id,
}: {
    filename: string;
    controller: AbortController;
    download_id: number;
}): void {
    is_showing_download_history = false;
    feedback_widget.show({
        container_class: DOWNLOAD_FEEDBACK_CONTAINER_CLASS,
        title_text: $t({defaultMessage: "Downloading {filename}"}, {filename}),
        undo_button_text: $t({defaultMessage: "Cancel"}),
        on_undo() {
            controller.abort();
        },
        hide_delay: IN_PROGRESS_HIDE_DELAY_MS,
        populate($container) {
            $container.empty();
            $container.append(
                $("<div>")
                    .addClass("download-feedback-status")
                    .text($t({defaultMessage: "Starting download…"})),
            );
            $container.append(
                $("<div>")
                    .addClass("progress active download-feedback-progress")
                    .append($("<div>").addClass("bar")),
            );
            render_download_actions($container, download_id);
        },
    });
}

function show_download_complete_feedback({
    filename,
    download_id,
}: {
    filename: string;
    download_id: number;
}): void {
    is_showing_download_history = false;
    feedback_widget.show({
        container_class: DOWNLOAD_FEEDBACK_CONTAINER_CLASS,
        title_text: $t({defaultMessage: "Download complete"}),
        undo_button_text: $t({defaultMessage: "Open file"}),
        on_undo() {
            open_download_from_history(download_id);
        },
        hide_delay: COMPLETED_HIDE_DELAY_MS,
        populate($container) {
            $container.empty();
            $container.append(
                $("<div>")
                    .addClass("download-feedback-status")
                    .text($t({defaultMessage: "{filename} downloaded."}, {filename})),
            );
            render_download_actions($container, download_id);
        },
    });
}

function show_download_cancelled_feedback(download_id: number): void {
    is_showing_download_history = false;
    feedback_widget.show({
        container_class: DOWNLOAD_FEEDBACK_CONTAINER_CLASS,
        title_text: $t({defaultMessage: "Download cancelled"}),
        populate($container) {
            $container.empty();
            $container.append(
                $("<div>")
                    .addClass("download-feedback-status")
                    .text($t({defaultMessage: "The download was cancelled."})),
            );
            render_download_actions($container, download_id);
        },
        hide_delay: CANCELLED_HIDE_DELAY_MS,
    });
}

function show_download_failed_feedback({
    filename,
    download_url,
    filename_hint,
    download_id,
}: {
    filename: string;
    download_url: string;
    filename_hint: string | undefined;
    download_id: number;
}): void {
    is_showing_download_history = false;
    feedback_widget.show({
        container_class: DOWNLOAD_FEEDBACK_CONTAINER_CLASS,
        title_text: $t({defaultMessage: "Download failed"}),
        undo_button_text: $t({defaultMessage: "Retry"}),
        on_undo() {
            start_tracked_download(download_url, filename_hint);
        },
        populate($container) {
            $container.empty();
            $container.append(
                $("<div>")
                    .addClass("download-feedback-status")
                    .text(
                        $t(
                            {
                                defaultMessage: "Couldn't download {filename}.",
                            },
                            {
                                filename,
                            },
                        ),
                    ),
            );
            render_download_actions($container, download_id);
        },
        hide_delay: FAILED_HIDE_DELAY_MS,
    });
}

function trigger_browser_download(object_url: string, filename: string): void {
    const link = document.createElement("a");
    link.href = object_url;
    link.download = filename;
    link.style.display = "none";
    document.body.append(link);
    link.click();
    link.remove();
}

function trigger_browser_managed_download(download_url: string, filename_hint?: string): void {
    const link = document.createElement("a");
    link.href = download_url;
    if (filename_hint !== undefined) {
        link.download = sanitize_filename(filename_hint);
    }
    link.rel = "noopener noreferrer";
    link.style.display = "none";
    document.body.append(link);
    link.click();
    link.remove();
}

async function read_download_blob({
    response,
    on_progress,
}: {
    response: Response;
    on_progress: (bytes_downloaded: number, bytes_total: number | undefined) => void;
}): Promise<Blob> {
    const bytes_total = parse_content_length(response.headers.get("Content-Length"));

    if (response.body === null) {
        const blob = await response.blob();
        on_progress(blob.size, bytes_total ?? blob.size);
        return blob;
    }

    const reader = response.body.getReader();
    const chunks: BlobPart[] = [];
    let bytes_downloaded = 0;
    on_progress(0, bytes_total);

    while (true) {
        const {done, value} = await reader.read();
        if (done) {
            break;
        }
        if (value !== undefined) {
            const chunk = new Uint8Array(value);
            chunks.push(chunk);
            bytes_downloaded += chunk.byteLength;
            on_progress(bytes_downloaded, bytes_total);
        }
    }

    return new Blob(chunks, {
        type: response.headers.get("Content-Type") ?? "application/octet-stream",
    });
}

export function show_download_started_confirmation(): void {
    is_showing_download_history = false;
    feedback_widget.show({
        container_class: DOWNLOAD_FEEDBACK_CONTAINER_CLASS,
        populate($container) {
            $container.text($t({defaultMessage: "Your download has started."}));
        },
        title_text: $t({defaultMessage: "Download started"}),
        hide_delay: 3000,
    });
}

export function start_browser_managed_download(download_url: string, filename_hint?: string): void {
    trigger_browser_managed_download(download_url, filename_hint);
    show_download_started_confirmation();
}

export function start_tracked_download(download_url: string, filename_hint?: string): void {
    void (async () => {
        let filename = sanitize_filename(filename_hint ?? extract_filename_from_url(download_url));
        const download_item = add_download_history_item({filename, download_url});
        const controller = new AbortController();
        tracked_download_controllers.set(download_item.id, controller);
        set_active_feedback_download(download_item.id);

        show_download_progress_feedback({filename, controller, download_id: download_item.id});

        try {
            const response = await fetch(download_url, {
                method: "GET",
                credentials: "same-origin",
                signal: controller.signal,
            });

            if (!response.ok) {
                throw new Error(`Download request failed with status ${response.status}`);
            }

            filename = sanitize_filename(
                filename_hint ??
                    extract_filename_from_content_disposition(
                        response.headers.get("Content-Disposition"),
                    ) ??
                    extract_filename_from_url(download_url),
            );
            download_item.filename = filename;

            const blob = await read_download_blob({
                response,
                on_progress(bytes_downloaded, bytes_total) {
                    download_item.bytes_downloaded = bytes_downloaded;
                    download_item.bytes_total = bytes_total;
                    refresh_visible_download_history();
                    if (is_active_feedback_download(download_item.id)) {
                        update_feedback_progress({bytes_downloaded, bytes_total});
                    }
                },
            });

            if (controller.signal.aborted) {
                return;
            }

            const object_url = URL.createObjectURL(blob);
            download_item.object_url = object_url;
            download_item.status = "completed";
            download_item.bytes_downloaded = blob.size;
            download_item.bytes_total = blob.size;

            trigger_browser_download(object_url, filename);
            refresh_visible_download_history();
            if (is_active_feedback_download(download_item.id)) {
                show_download_complete_feedback({filename, download_id: download_item.id});
            }

            setTimeout(() => {
                URL.revokeObjectURL(object_url);
                if (download_item.object_url === object_url) {
                    download_item.object_url = undefined;
                    refresh_visible_download_history();
                }
            }, OBJECT_URL_TTL_MS);

            release_tracked_download(download_item.id);
        } catch (error) {
            if (controller.signal.aborted) {
                download_item.status = "cancelled";
                refresh_visible_download_history();
                if (is_active_feedback_download(download_item.id)) {
                    show_download_cancelled_feedback(download_item.id);
                }
                release_tracked_download(download_item.id);
                return;
            }

            download_item.status = "failed";
            blueslip.error(`Download failed for ${download_url}: ${String(error)}`);
            refresh_visible_download_history();
            if (is_active_feedback_download(download_item.id)) {
                show_download_failed_feedback({
                    filename,
                    download_url,
                    filename_hint,
                    download_id: download_item.id,
                });
            }
            release_tracked_download(download_item.id);
        }
    })();
}
