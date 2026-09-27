import "./globals.css"

export const metadata = {
  title: "Griffin Simulator",
  description: "Griffin Simulator",
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0, overflow: "hidden", width: "100vw", height: "100vh" }}>
        {children}
      </body>
    </html>
  )
}
