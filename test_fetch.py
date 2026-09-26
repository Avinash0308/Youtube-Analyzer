from youtube_transcript_api import YouTubeTranscriptApi
t_list = YouTubeTranscriptApi.list_transcripts('i0OFT-BuopE')
en = t_list.find_transcript(['en'])
print(en._url)
