.PHONY: info
info:
	@echo "- type 'make web-serve' to serve the application"
	@echo "- type 'make web-test' to run the test suite"
	@echo


# the port the application is served on
WEB_PORT ?= 8000

# serve the application. Web Serial needs a secure context, which
# http://localhost counts as, so this is enough to use a real device.
.PHONY: web-serve
web-serve:
	@echo "Open http://localhost:$(WEB_PORT) in Chrome, Edge or Opera"
	cd web && python3 -m http.server $(WEB_PORT) --bind 127.0.0.1


# run the test suite. Needs node, nothing else.
.PHONY: web-test
web-test:
	node web/tests/run.js \
	  ./core.test.js ./numeric.test.js ./analysis.test.js \
	  ./device.test.js ./sweep.test.js ./panels.test.js ./charts.test.js
