import { Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu"

export async function createMenu(trigger: (id: string) => void) {
  try {
    const menu = await Menu.new({
      items: [
        // File menu
        await Submenu.new({
          text: "File",
          items: [
            await MenuItem.new({
              text: "Add Server...",
              accelerator: "CmdOrCtrl+N",
              action: () => trigger("server.add"),
            }),
            await PredefinedMenuItem.new({ item: "Separator" }),
            await MenuItem.new({
              text: "Settings",
              accelerator: "CmdOrCtrl+,",
              action: () => trigger("settings.open"),
            }),
            await PredefinedMenuItem.new({ item: "Separator" }),
            await PredefinedMenuItem.new({ item: "Quit" }),
          ],
        }),
        // Edit menu
        await Submenu.new({
          text: "Edit",
          items: [
            await PredefinedMenuItem.new({ item: "Undo" }),
            await PredefinedMenuItem.new({ item: "Redo" }),
            await PredefinedMenuItem.new({ item: "Separator" }),
            await PredefinedMenuItem.new({ item: "Cut" }),
            await PredefinedMenuItem.new({ item: "Copy" }),
            await PredefinedMenuItem.new({ item: "Paste" }),
            await PredefinedMenuItem.new({ item: "SelectAll" }),
          ],
        }),
        // View menu
        await Submenu.new({
          text: "View",
          items: [
            await MenuItem.new({
              text: "Inbox",
              accelerator: "Shift+I",
              action: () => trigger("nav.inbox"),
            }),
            await MenuItem.new({
              text: "Recent Conversations",
              accelerator: "T",
              action: () => trigger("nav.recent"),
            }),
            await MenuItem.new({
              text: "All Messages",
              accelerator: "A",
              action: () => trigger("nav.all"),
            }),
            await PredefinedMenuItem.new({ item: "Separator" }),
            await MenuItem.new({
              text: "Command Palette",
              accelerator: "CmdOrCtrl+Shift+P",
              action: () => trigger("command-palette.open"),
            }),
            await PredefinedMenuItem.new({ item: "Separator" }),
            await MenuItem.new({
              text: "Toggle Do Not Disturb",
              accelerator: "CmdOrCtrl+Shift+M",
              action: () => trigger("dnd.toggle"),
            }),
          ],
        }),
        // Window menu
        await Submenu.new({
          text: "Window",
          items: [
            await PredefinedMenuItem.new({ item: "Minimize" }),
            await PredefinedMenuItem.new({ item: "Maximize" }),
            await PredefinedMenuItem.new({ item: "Separator" }),
            await MenuItem.new({
              text: "Toggle Sidebar",
              accelerator: "CmdOrCtrl+Shift+S",
              action: () => trigger("sidebar.toggle"),
            }),
          ],
        }),
        // Help menu
        await Submenu.new({
          text: "Help",
          items: [
            await MenuItem.new({
              text: "Keyboard Shortcuts",
              accelerator: "?",
              action: () => trigger("help.shortcuts"),
            }),
            await PredefinedMenuItem.new({ item: "Separator" }),
            await MenuItem.new({
              text: "Zulip Help Center",
              action: () => trigger("help.center"),
            }),
          ],
        }),
      ],
    })

    await menu.setAsAppMenu()
  } catch (e) {
    console.warn("Failed to create native menu:", e)
  }
}
