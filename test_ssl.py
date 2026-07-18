import urllib.request
import ssl
import os

print("Proxy is:", os.environ.get("HTTPS_PROXY"))
context = ssl._create_unverified_context()
try:
    res = urllib.request.urlopen("https://api.github.com", context=context, timeout=10)
    print("Succeeded! Status:", res.status)
    print(res.read()[:100])
except Exception as e:
    print("Failed:", str(e))
