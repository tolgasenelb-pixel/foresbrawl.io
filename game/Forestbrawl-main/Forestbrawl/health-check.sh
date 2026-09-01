#!/bin/bash
# Production Health Check Script
# Useful for monitoring and debugging

if [ -z "$1" ]; then
    echo "Usage: ./health-check.sh <url>"
    echo "Example: ./health-check.sh https://forestbrawl.onrender.com"
    exit 1
fi

URL="$1"
ENDPOINT="${URL}/api/health"

echo "🏥 Forestbrawl Health Check"
echo "============================"
echo "Checking: $ENDPOINT"
echo ""

# Check if service is running
RESPONSE=$(curl -s -w "\n%{http_code}" "$ENDPOINT")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ Service is ONLINE"
    echo "Response: $BODY"
else
    echo "❌ Service is OFFLINE (HTTP $HTTP_CODE)"
    echo "Response: $BODY"
    exit 1
fi

echo ""
echo "📊 Additional checks:"

# Check response time
RESPONSE_TIME=$(curl -s -o /dev/null -w "%{time_total}" "$ENDPOINT")
echo "   Response time: ${RESPONSE_TIME}s"

# Check certificate (if HTTPS)
if [[ "$URL" == https://* ]]; then
    CERT_DAYS=$(echo | openssl s_client -servername "${URL#https://}" -connect "${URL#https://}:443" 2>/dev/null | openssl x509 -noout -dates 2>/dev/null | grep "notAfter" | cut -d= -f2)
    echo "   SSL Certificate expires: $CERT_DAYS"
fi

echo ""
echo "✅ Health check complete"
