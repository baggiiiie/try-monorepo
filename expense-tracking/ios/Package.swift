// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "ExpenseTracker",
    platforms: [.iOS(.v17)],
    dependencies: [
        .package(url: "https://github.com/groue/GRDB.swift.git", from: "7.0.0"),
    ],
    targets: [
        .executableTarget(
            name: "ExpenseTracker",
            dependencies: [
                .product(name: "GRDB", package: "GRDB.swift"),
            ],
            path: "ExpenseTracker"
        ),
    ]
)
