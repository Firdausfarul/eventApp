# Instagram public extraction notes

These are two lightweight techniques that worked for public Instagram content.
They use Instagram Web's public/internal responses, not the official Instagram
Graph API. Treat them as brittle: endpoints, required headers, and rate limits
can change without notice.

## 1. Fetch a public profile timeline

Use the public profile page to discover profile metadata, then call the same
timeline endpoint Instagram Web prepares for the browser.

### Steps

1. Download the public profile HTML.

```bash
curl -sL -A 'Mozilla/5.0' \
  'https://www.instagram.com/uni_eropa/' \
  -o /tmp/uni_eropa.html
```

2. Extract useful metadata from the HTML.

Look for:

- `profile_id`
- `X-IG-App-ID`
- profile title/description
- route config mentioning `/api/v1/feed/user/{username}/username/`

Example quick checks:

```bash
rg -n 'profile_id|X-IG-App-ID|web_profile_info|feed/user' /tmp/uni_eropa.html
```

3. Fetch recent feed items.

```bash
curl -sL \
  -A 'Mozilla/5.0' \
  -H 'x-ig-app-id: 936619743392459' \
  -H 'x-requested-with: XMLHttpRequest' \
  -H 'referer: https://www.instagram.com/uni_eropa/' \
  'https://www.instagram.com/api/v1/feed/user/uni_eropa/username/?count=12'
```

The JSON response can include:

- post `code`, used in `https://www.instagram.com/p/{code}/`
- `taken_at`
- `media_type`
- `product_type`
- caption text
- carousel media metadata

Minimal Python parser:

```python
import datetime
import requests

username = "uni_eropa"
url = f"https://www.instagram.com/api/v1/feed/user/{username}/username/?count=12"
headers = {
    "User-Agent": "Mozilla/5.0",
    "x-ig-app-id": "936619743392459",
    "x-requested-with": "XMLHttpRequest",
    "referer": f"https://www.instagram.com/{username}/",
}

data = requests.get(url, headers=headers, timeout=20).json()

for item in data.get("items", [])[:8]:
    code = item.get("code")
    taken_at = item.get("taken_at")
    date = datetime.datetime.fromtimestamp(taken_at).isoformat() if taken_at else ""
    caption = (item.get("caption") or {}).get("text") or ""
    carousel_count = len(item.get("carousel_media") or [])

    print(f"https://www.instagram.com/p/{code}/")
    print(date, item.get("media_type"), item.get("product_type"), carousel_count)
    print(" ".join(caption.split())[:300])
    print()
```

### Notes and limits

- This is an internal Instagram Web endpoint, not a documented developer API.
- Public profiles may still return login walls, empty responses, or partial data.
- Pinned posts can appear before newer chronological posts.
- Pagination and high-volume fetching are more likely to trigger throttling.
- Rate limits are not published. Go slowly and expect temporary blocks.

## 2. Extract a public post or carousel through `/embed/`

For a known public post URL, Instagram's embed page can expose media URLs for
the post. This is useful for downloading carousel slides at display resolution.

Example post:

```text
https://www.instagram.com/p/DaRynkVkqBq/
```

### Steps

1. Download the embed HTML.

```bash
curl -sL -A 'Mozilla/5.0' \
  'https://www.instagram.com/p/DaRynkVkqBq/embed/' \
  -o /tmp/ig_embed.html
```

2. Search for media fields.

```bash
rg -n 'display_url|display_resources|shortcode|accessibility_caption' /tmp/ig_embed.html
```

3. Extract `display_url` values and download them.

```python
import html
import pathlib
import re
import requests

text = pathlib.Path("/tmp/ig_embed.html").read_text()
urls = []

for raw in re.findall(r'display_url\\":\\"(https:.*?)(?=\\")', text):
    url = raw.encode().decode("unicode_escape")
    url = url.replace("\\/", "/").replace("\\%", "%")
    url = html.unescape(url)
    if url not in urls:
        urls.append(url)

out = pathlib.Path("/tmp/ig_events")
out.mkdir(exist_ok=True)

for index, url in enumerate(urls, 1):
    response = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=30)
    response.raise_for_status()
    path = out / f"slide{index}.jpg"
    path.write_bytes(response.content)
    print(path, len(response.content))
```

For the tested carousel, the downloaded slides were:

- `1080 x 1350 px`
- JPEG
- around `93 KB` to `231 KB` per slide
- good enough for manual visual extraction

### Notes and limits

- `/embed/` works best when the exact post shortcode is already known.
- It does not reliably discover the latest posts from a profile by itself.
- The image URLs are signed CDN URLs and can expire.
- The downloaded media is Instagram's compressed display version, not the
  original upload file.
- OCR can still struggle with small text because of compression and layout.

## Practical workflow

Use both techniques together:

1. Fetch the profile timeline to get recent post links.
2. For each post with `media_type == 8` or a single image, fetch `/embed/`.
3. Download `display_url` media.
4. Extract event text visually or with OCR.

For reels, the timeline endpoint usually gives caption and metadata, but visual
text extraction requires downloading/inspecting video frames.
