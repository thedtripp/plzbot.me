Every time your browser makes a request, it leaves something behind. Not a cookie -- something
harder to clear. The order your headers arrive in. The exact set of cipher suites your TLS
library offers, before a single byte of HTTP is sent. None of these signals were designed to
identify you. But put enough of them together, and a server can tell curl from Chrome, and a
real Chrome from a scripted one, without ever asking you to log in. This is episode one: why
fingerprinting exists.
