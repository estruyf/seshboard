// Seshboard's Dock tile plug-in (macOS): keeps the app icon chosen in Settings › Theme › App icon in the Dock after
// the app quits. While Seshboard runs, main sets the Dock icon itself (app.dock.setIcon), which lasts only as long as
// the process. The Dock loads this plug-in for an app kept in the Dock (Info.plist's NSDockTilePlugIn) and lets it draw
// the tile while the app is not running.
//
// Main writes the colourway's key to the app's defaults (SeshboardAppIcon) and posts SeshboardAppIconChanged. The
// plug-in reads the key again on that notification, when the app quits, and when the Dock loads it. The colourway's
// file is in the app's own Resources/app-icons; Graphite, or a key it can't use, shows the bundle's icon.
//
// Built and put into the app by scripts/dockTile.mjs (from afterPack), so electron-builder signs it with the app.

import AppKit

@objc(SeshboardDockTilePlugIn)
final class SeshboardDockTilePlugIn: NSObject, NSDockTilePlugIn {
  private var dockTile: NSDockTile?
  private var observers: [(NotificationCenter, NSObjectProtocol)] = []

  /// The app this plug-in is inside: Seshboard.app/Contents/PlugIns/SeshboardDockTile.docktileplugin.
  private lazy var appBundle: Bundle? = {
    let app = Bundle(for: SeshboardDockTilePlugIn.self).bundleURL
      .deletingLastPathComponent() // PlugIns
      .deletingLastPathComponent() // Contents
      .deletingLastPathComponent() // Seshboard.app
    return Bundle(url: app)
  }()

  func setDockTile(_ dockTile: NSDockTile?) {
    self.dockTile = dockTile
    for (center, observer) in observers { center.removeObserver(observer) }
    observers = []
    guard dockTile != nil, let appId = appBundle?.bundleIdentifier else { return }

    let changed = DistributedNotificationCenter.default().addObserver(forName: Notification.Name("SeshboardAppIconChanged"), object: nil, queue: .main) { [weak self] _ in
      // The app's defaults reach cfprefsd a moment after the notification.
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self?.update() }
    }
    observers.append((DistributedNotificationCenter.default(), changed))
    let workspace = NSWorkspace.shared.notificationCenter
    let quit = workspace.addObserver(forName: NSWorkspace.didTerminateApplicationNotification, object: nil, queue: .main) { [weak self] note in
      let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
      if app?.bundleIdentifier == appId { self?.update() }
    }
    observers.append((workspace, quit))
    update()
  }

  /// Draws the chosen colourway on the tile, or gives the tile back to the bundle's icon.
  private func update() {
    guard let dockTile, let app = appBundle, let appId = app.bundleIdentifier else { return }
    CFPreferencesAppSynchronize(appId as CFString)
    let key = UserDefaults(suiteName: appId)?.string(forKey: "SeshboardAppIcon") ?? "graphite"
    // Keys are lowercase words with hyphens (APP_ICON_KEYS); anything else is never a file name.
    let valid = !key.isEmpty && key.allSatisfy { $0 == "-" || ($0.isASCII && ($0.isLowercase || $0.isNumber)) }
    let file = app.resourceURL?.appendingPathComponent("app-icons").appendingPathComponent("\(key).png")
    if key == "graphite" || !valid || file == nil {
      dockTile.contentView = nil
    } else if let file, let image = NSImage(contentsOf: file) {
      let view = NSImageView(frame: NSRect(origin: .zero, size: dockTile.size))
      view.imageScaling = .scaleProportionallyUpOrDown
      view.image = image
      dockTile.contentView = view
    } else {
      dockTile.contentView = nil
    }
    dockTile.display()
  }
}
