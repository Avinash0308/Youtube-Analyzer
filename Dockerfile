# Use official Python runtime as a parent image
FROM python:3.10-slim

# Set working directory
WORKDIR /app

# Install system dependencies including ffmpeg for yt-dlp
RUN apt-get update && apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application
COPY . .

# Allow Cloud Run to set the port
ENV PORT=8080
EXPOSE $PORT

# Run gunicorn with a long timeout because video processing takes time
CMD gunicorn --bind 0.0.0.0:$PORT --workers 1 --threads 8 --timeout 300 app:app
