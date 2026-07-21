import os
import json
import base64
import urllib.request
import subprocess

# Bypass local proxy when running unsandboxed
os.environ.pop('HTTP_PROXY', None)
os.environ.pop('HTTPS_PROXY', None)

# Load token and username
try:
    with open("github_token.txt", "r") as f:
        lines = [line.strip() for line in f.readlines() if line.strip()]
        token = lines[0]
        username = lines[1]
except Exception as e:
    print("ERROR: Please create 'github_token.txt' with your token on the first line and your username on the second line.")
    exit(1)

repo_name = "solana-alpha-scanner"

# Helper function to make GitHub API requests
def github_request(url, method="GET", data=None):
    req = urllib.request.Request(url, method=method)
    req.add_header("Authorization", f"token {token}")
    req.add_header("Accept", "application/vnd.github.v3+json")
    req.add_header("User-Agent", "Solana-Scanner-Deployer")
    if data is not None:
        req.add_header("Content-Type", "application/json")
        data_bytes = json.dumps(data).encode("utf-8")
    else:
        data_bytes = None
    try:
        with urllib.request.urlopen(req, data=data_bytes) as res:
            return json.loads(res.read().decode("utf-8")), res.status
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        try:
            return json.loads(body), e.code
        except:
            return {"message": body}, e.code
    except Exception as e:
        return {"message": str(e)}, 500

# 1. Create Repository
print(f"Creating GitHub repository '{repo_name}'...")
create_data = {
    "name": repo_name,
    "description": "Solana Alpha Scanner live deployment",
    "private": False
}
res, code = github_request("https://api.github.com/user/repos", method="POST", data=create_data)
if code == 201:
    print("Repository created successfully!")
elif code == 422:
    print("Repository already exists. Proceeding...")
else:
    print(f"Error creating repository: {res.get('message')}")
    exit(1)

# 2. Upload Files
files = [
    "index.html", "index.css", "app.js", "bubble-map.js", 
    "cluster-intel.js", "db.js", "paper-trade.js", "radar.js", "sniper-engine.js"
]

print("Uploading files to GitHub...")
for filepath in files:
    if not os.path.exists(filepath):
        print(f"Warning: file {filepath} not found, skipping.")
        continue
    with open(filepath, "rb") as f:
        content = base64.b64encode(f.read()).decode("utf-8")
    
    # Check if file exists to get SHA (for updates)
    sha = None
    get_res, get_code = github_request(f"https://api.github.com/repos/{username}/{repo_name}/contents/{filepath}")
    if get_code == 200:
        sha = get_res.get("sha")
    
    upload_data = {
        "message": f"Upload {filepath}",
        "content": content,
        "branch": "main"
    }
    if sha:
        upload_data["sha"] = sha
        
    res, code = github_request(f"https://api.github.com/repos/{username}/{repo_name}/contents/{filepath}", method="PUT", data=upload_data)
    if code in [200, 201]:
        print(f"Uploaded {filepath} successfully!")
    else:
        print(f"Failed to upload {filepath}: {res.get('message')}")
        exit(1)

print("All files uploaded to GitHub successfully!")

# 3. Create Azure Static Web App (Skipped because SWA is already active and linked to GitHub)
print("Azure Static Web App is already active. Skipping resource recreation to preserve workflow settings.")
