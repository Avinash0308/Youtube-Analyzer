from flask import Flask, request
from youtube_transcript_api import YouTubeTranscriptApi
from transformers import pipeline
import google.generativeai as genai

app = Flask(__name__)


@app.get('/summary')
def summary_api():
    url = request.args.get('url', '')
    video_id = url.split('=')[1]
    summary = get_summary(get_transcript(video_id))
    return summary, 200


def get_transcript(video_id):
    transcript_list = YouTubeTranscriptApi.get_transcript(
        video_id, languages=['hi', 'en'])
    transcript = ' '.join([d['text'] for d in transcript_list])
    return transcript


def get_summary(transcript):
    summariser = pipeline(task="summarization",
                          model="csebuetnlp/mT5_multilingual_XLSum")
    summary = ''
    for i in range(0, (len(transcript)//500)+1):
        summary_text = summariser(
            transcript[i*500:(i+1)*500])[0]['summary_text']
        summary = summary + summary_text + ' '
    return summary


@app.get('/answer')
def answer_api():
    summary = request.args.get('summary', '')
    question = summary.split('=')[0]
    answer = get_answer(question)
    return answer


def get_answer(question):

    convo = question

    genai.configure(api_key="AIzaSyCSLT7qkguZQWQ-i_TeUN6gCqRH_fRzqxw")

    # Set up the model
    generation_config = {
        "temperature": 0.9,
        "top_p": 1,
        "top_k": 1,
        "max_output_tokens": 2048,
    }

    safety_settings = [
        {
            "category": "HARM_CATEGORY_HARASSMENT",
            "threshold": "BLOCK_MEDIUM_AND_ABOVE"
        },
        {
            "category": "HARM_CATEGORY_HATE_SPEECH",
            "threshold": "BLOCK_MEDIUM_AND_ABOVE"
        },
        {
            "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT",
            "threshold": "BLOCK_MEDIUM_AND_ABOVE"
        },
        {
            "category": "HARM_CATEGORY_DANGEROUS_CONTENT",
            "threshold": "BLOCK_MEDIUM_AND_ABOVE"
        },
    ]

    model = genai.GenerativeModel(
        model_name="gemini-1.0-pro", generation_config=generation_config, safety_settings=safety_settings)

    conversation = model.start_chat(history=[])

    conversation.send_message(convo)

    return conversation.last.text


@app.get('/transcript')
def transcript_provider():
    url = request.args.get('url', '')
    video_id = url.split('=')[1]
    transcript_list = YouTubeTranscriptApi.get_transcript(
        video_id, languages=['hi', 'en'])
    transcript = ' '.join([d['text'] for d in transcript_list])
    return transcript


if __name__ == '__main__':
    app.run()
