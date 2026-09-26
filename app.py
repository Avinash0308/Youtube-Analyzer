import os
import time
import tempfile
import subprocess
import requests
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
from youtube_transcript_api import YouTubeTranscriptApi
from googleapiclient.discovery import build
import google.generativeai as genai

# ─── Load Environment ───────────────────────────────────────────────
load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
YOUTUBE_API_KEY = os.getenv("YOUTUBE_API_KEY")

genai.configure(api_key=GEMINI_API_KEY)
youtube = build("youtube", "v3", developerKey=YOUTUBE_API_KEY)

# ─── Flask App Setup ────────────────────────────────────────────────
app = Flask(__name__)
CORS(app)


# ═══════════════════════════════════════════════════════════════════
#  HELPER FUNCTIONS
# ═══════════════════════════════════════════════════════════════════

def extract_video_id(url):
    """Extract the YouTube video ID from various URL formats."""
    if "youtu.be/" in url:
        return url.split("youtu.be/")[1].split("?")[0]
    if "v=" in url:
        return url.split("v=")[1].split("&")[0]
    return None


def fetch_metadata(video_id):
    """Fetch video metadata using YouTube Data API v3."""
    try:
        response = youtube.videos().list(
            part="snippet,contentDetails,statistics",
            id=video_id
        ).execute()

        if not response["items"]:
            return None

        item = response["items"][0]
        snippet = item["snippet"]
        stats = item["statistics"]
        content = item["contentDetails"]

        return {
            "title": snippet.get("title", ""),
            "channel": snippet.get("channelTitle", ""),
            "publishedAt": snippet.get("publishedAt", ""),
            "description": snippet.get("description", "")[:500],
            "duration": content.get("duration", ""),
            "viewCount": stats.get("viewCount", "N/A"),
            "likeCount": stats.get("likeCount", "N/A"),
            "commentCount": stats.get("commentCount", "N/A"),
            "thumbnail": snippet.get("thumbnails", {}).get("high", {}).get("url", ""),
        }
    except Exception as e:
        print(f"Error fetching metadata: {e}")
        return None


def fetch_comments(video_id, max_results=100):
    """Fetch top comments using YouTube Data API v3."""
    try:
        comments = []
        response = youtube.commentThreads().list(
            part="snippet",
            videoId=video_id,
            order="relevance",
            maxResults=min(max_results, 100),
            textFormat="plainText"
        ).execute()

        for item in response.get("items", []):
            comment = item["snippet"]["topLevelComment"]["snippet"]
            comments.append({
                "author": comment.get("authorDisplayName", ""),
                "text": comment.get("textDisplay", ""),
                "likes": comment.get("likeCount", 0),
            })

        return comments
    except Exception as e:
        print(f"Error fetching comments: {e}")
        return []


def fetch_transcript(video_id):
    """Fetch video transcript with timestamps."""
    try:
        transcript_list = YouTubeTranscriptApi.get_transcript(
            video_id, languages=["en", "hi", "es", "fr", "de", "ja", "ko", "pt", "ru", "zh"]
        )
        # Build both a plain text version and a timestamped version
        plain_text = " ".join([entry["text"] for entry in transcript_list])
        timestamped = [
            {"time": round(entry["start"], 1), "text": entry["text"]}
            for entry in transcript_list
        ]
        return {"plain": plain_text, "timestamped": timestamped}
    except Exception as e:
        error_msg = str(e)
        if "no element found" in error_msg.lower():
            print("\n[WARNING] YouTube temporarily blocked transcript downloads (HTTP 429 Rate Limit) because of too many requests. Continuing without transcript.")
        else:
            print(f"Error fetching transcript: {error_msg}")
        return {"plain": "", "timestamped": []}


def download_video(video_id):
    """Download a low-res version of the video using yt-dlp."""
    try:
        temp_dir = tempfile.mkdtemp()
        output_path = os.path.join(temp_dir, f"{video_id}.mp4")
        url = f"https://www.youtube.com/watch?v={video_id}"

        subprocess.run([
            "yt-dlp",
            "-f", "worstvideo+worstaudio/worst",  # Lowest quality for speed
            "--no-playlist",
            "--max-filesize", "50M",
            "-o", output_path,
            url
        ], check=True, capture_output=True, timeout=120)

        if os.path.exists(output_path):
            return output_path
        return None
    except Exception as e:
        print(f"Error downloading video: {e}")
        return None


def upload_to_gemini(video_path):
    """Upload a video file to Gemini File API and wait for processing."""
    try:
        file_size = os.path.getsize(video_path)
        
        # 1. Start resumable session
        res = requests.post(
            f"https://generativelanguage.googleapis.com/upload/v1beta/files?key={GEMINI_API_KEY}",
            headers={
                "X-Goog-Upload-Protocol": "resumable",
                "X-Goog-Upload-Command": "start",
                "X-Goog-Upload-Header-Content-Length": str(file_size),
                "X-Goog-Upload-Header-Content-Type": "video/mp4",
                "Content-Type": "application/json"
            },
            json={"file": {"display_name": "youtube_video"}}
        )
        
        if res.status_code != 200:
            print("Upload start failed:", res.text)
            return None
            
        upload_url = res.headers.get("X-Goog-Upload-URL")
        
        # 2. Upload file bytes
        with open(video_path, "rb") as f:
            res2 = requests.post(
                upload_url,
                headers={
                    "X-Goog-Upload-Command": "upload, finalize",
                    "X-Goog-Upload-Offset": "0"
                },
                data=f
            )
            
        if res2.status_code != 200:
            print("Upload finalize failed:", res2.text)
            return None
            
        file_name = res2.json().get("file", {}).get("name")
        if not file_name:
            return None
            
        video_file = genai.get_file(file_name)

        # Wait for the file to be processed
        while video_file.state.name == "PROCESSING":
            time.sleep(2)
            video_file = genai.get_file(video_file.name)

        if video_file.state.name == "ACTIVE":
            return video_file
        else:
            print(f"File processing failed: {video_file.state.name}")
            return None
    except Exception as e:
        print(f"Error uploading to Gemini: {e}")
        return None


# ═══════════════════════════════════════════════════════════════════
#  API ROUTES
# ═══════════════════════════════════════════════════════════════════

@app.route("/initialize", methods=["POST"])
def initialize():
    """
    Initialize AI for a YouTube video.
    Downloads the video, uploads to Gemini, fetches metadata/comments/transcript.
    Returns everything the frontend needs to start a chat session.
    """
    data = request.get_json()
    url = data.get("url", "")
    video_id = extract_video_id(url)

    if not video_id:
        return jsonify({"error": "Invalid YouTube URL"}), 400

    # ── Step 1: Fetch metadata & comments & transcript in sequence ──
    metadata = fetch_metadata(video_id)
    if not metadata:
        return jsonify({"error": "Could not fetch video metadata"}), 404

    comments = fetch_comments(video_id)
    transcript_data = fetch_transcript(video_id)

    # ── Step 2: Download low-res video ──
    video_path = download_video(video_id)
    gemini_file_uri = None

    if video_path:
        # ── Step 3: Upload to Gemini File API ──
        gemini_file = upload_to_gemini(video_path)
        if gemini_file:
            gemini_file_uri = gemini_file.name

        # ── Step 4: Cleanup local file ──
        try:
            os.remove(video_path)
            os.rmdir(os.path.dirname(video_path))
        except OSError:
            pass

    return jsonify({
        "success": True,
        "videoId": video_id,
        "metadata": metadata,
        "comments": comments,
        "transcript": transcript_data,
        "geminiFileUri": gemini_file_uri,
    })


@app.route("/chat", methods=["POST"])
def chat():
    """
    Chat endpoint. Receives user message, conversation history,
    and optional context (transcript, comments, file URI for video).
    Returns the AI's response.
    """
    data = request.get_json()
    user_message = data.get("message", "")
    history = data.get("history", [])
    transcript = data.get("transcript", "")
    comments_text = data.get("commentsText", "")
    gemini_file_uri = data.get("geminiFileUri", None)
    metadata_text = data.get("metadataText", "")

    if not user_message:
        return jsonify({"error": "No message provided"}), 400

    # ── Build the system prompt ──
    system_prompt = """You are an intelligent YouTube Video Analyzer assistant. You have access to a YouTube video's full transcript, its visual content, viewer comments, and metadata.

Your capabilities:
1. **Summarize** the video content clearly and concisely.
2. **Answer questions** about anything in the video — both spoken content and visual elements.
3. **Provide timestamps** when asked about specific moments, characters, objects, or events. Format timestamps as clickable markers like [MM:SS].
4. **Analyze comments** to gauge viewer sentiment, common opinions, and notable feedback.
5. **Provide metadata** like view count, likes, channel name, duration, etc.

Rules:
- Always detect the language the user is typing in and respond in that same language.
- When providing timestamps, be as precise as possible using the format [MM:SS].
- Keep responses well-structured using bullet points and sections where appropriate.
- If you cannot determine something from the video content, say so honestly.
- Be conversational and helpful.
"""

    # ── Build context block ──
    context_parts = []
    if metadata_text:
        context_parts.append(f"VIDEO METADATA:\n{metadata_text}")
    if transcript:
        context_parts.append(f"VIDEO TRANSCRIPT:\n{transcript}")
    if comments_text:
        context_parts.append(f"VIEWER COMMENTS:\n{comments_text}")

    context_block = "\n\n---\n\n".join(context_parts)

    # ── Build conversation history for Gemini ──
    gemini_history = []
    for msg in history:
        role = "user" if msg["role"] == "user" else "model"
        gemini_history.append({"role": role, "parts": [msg["content"]]})

    # ── Fallback Model List (Best to Worst) ──
    models_to_try = [
        "gemini-3.8-flash",
        "gemini-3.7-flash",
        "gemini-3.6-flash",
        "gemini-3.5-flash",
        "gemini-3.5-flash-lite",
        "gemini-3.0-flash",
        "gemini-2.5-flash"
    ]
    
    last_error = None
    response_text = None

    # Build the message content parts
    message_parts = []

    # Attach the video file if available
    if gemini_file_uri:
        try:
            video_file = genai.get_file(gemini_file_uri)
            if video_file.state.name == "ACTIVE":
                message_parts.append(video_file)
        except Exception:
            pass  # Video file might have expired, continue without it

    # Add context and user message
    full_message = f"{context_block}\n\nUSER QUESTION: {user_message}" if context_block else user_message
    message_parts.append(full_message)

    for model_name in models_to_try:
        try:
            print(f"Attempting to chat with model: {model_name}")
            model = genai.GenerativeModel(
                model_name=model_name,
                system_instruction=system_prompt
            )
            chat_session = model.start_chat(history=gemini_history)
            response = chat_session.send_message(message_parts)
            response_text = response.text
            break # Success, break out of fallback loop
        except Exception as e:
            print(f"Model {model_name} failed: {e}")
            last_error = e
            continue

    if response_text is not None:
        return jsonify({
            "success": True,
            "response": response_text,
        })
    else:
        print(f"All models failed. Last error: {last_error}")
        return jsonify({"error": f"All AI models are currently busy or unavailable. Last error: {str(last_error)}"}), 500


# ═══════════════════════════════════════════════════════════════════
#  HEALTH CHECK
# ═══════════════════════════════════════════════════════════════════

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "message": "YouTube Analyzer Backend is running"})


if __name__ == "__main__":
    print("🚀 YouTube Analyzer Backend starting...")
    print(f"   Gemini API Key: {'✅ Loaded' if GEMINI_API_KEY else '❌ Missing'}")
    print(f"   YouTube API Key: {'✅ Loaded' if YOUTUBE_API_KEY else '❌ Missing'}")
    app.run(debug=True, port=5000)
