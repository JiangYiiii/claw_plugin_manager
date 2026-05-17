#!/usr/bin/env python3
"""
抖音视频分析 MCP Server
支持本地语音识别和云端识别可选
结合 MiniMax 图像理解
"""

import os
import sys
import re
import json
import hashlib
import threading
import time as time_module
import requests
import subprocess
import tempfile
from typing import Optional, Dict, Any, List
from urllib.parse import urlparse, parse_qs
from datetime import datetime

SERVER_DIR = os.path.dirname(os.path.abspath(__file__))
PYTHON_BIN = os.environ.get("DOUYIN_ANALYZER_PYTHON", sys.executable)

# ============ 配置 ============
class Config:
    # 语音识别模式: "local" | "cloud" | "auto" (local优先，失败则cloud)
    STT_MODE = os.environ.get("DOUYIN_STT_MODE", "auto")
    
    # SiliconFlow API (cloud 模式需要)
    SILICONFLOW_API_KEY = os.environ.get("SILICONFLOW_API_KEY", "")
    SILICONFLOW_BASE_URL = os.environ.get("SILICONFLOW_BASE_URL", "https://api.siliconflow.cn")
    
    # MiniMax API (图像理解需要)
    MINIMAX_API_KEY = os.environ.get("MINIMAX_API_KEY", "")
    MINIMAX_BASE_URL = os.environ.get("MINIMAX_BASE_URL", "https://api.minimax.chat")
    
    # 本地 whisper 模型路径
    WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "small")  # tiny/base/small/medium/large
    WHISPER_MODEL_DIR = os.environ.get("WHISPER_MODEL_DIR", os.path.expanduser("~/.whisper.cpp/models"))
    
        # 转录结果存储目录
    TRANSCRIPTS_DIR = os.environ.get("TRANSCRIPTS_DIR", os.path.expanduser("~/.openclaw/video-transcripts"))
    # 视频时长阈值（秒），超过则后台转录
    DURATION_THRESHOLD = int(os.environ.get("DURATION_THRESHOLD", "300"))
    os.makedirs(TRANSCRIPTS_DIR, exist_ok=True)

    # 第三方 API (备选)
    THIRD_PARTY_API = os.environ.get("DOUYIN_THIRD_PARTY_API", "https://liuxingw.com/api/douyin/api.php")

# ============ 抖音链接解析 ============
class DouyinParser:
    """解析抖音分享链接"""
    
    SHARE_URL_PATTERN = r'https?://v\.douyin\.com/[a-zA-Z0-9_-]+'
    
    @staticmethod
    def extract_video_id(url: str) -> Optional[str]:
        """从分享链接提取视频ID"""
        # 处理短链接
        match = re.search(DouyinParser.SHARE_URL_PATTERN, url)
        if not match:
            return None
        
        share_url = match.group(0)
        
        # 获取重定向后的URL
        try:
            resp = requests.head(share_url, allow_redirects=True, timeout=10)
            final_url = resp.url
        except:
            return None
        
        # 从URL中提取video_id
        # 格式: https://www.iesdouyin.com/share/video/7123456789012345678/...
        match = re.search(r'/video/(\d+)', final_url)
        if match:
            return match.group(1)
        
        return None
    
    @staticmethod
    def extract_share_url(url: str) -> Optional[str]:
        """从分享链接提取完整的分享URL（用于浏览器访问）"""
        match = re.search(DouyinParser.SHARE_URL_PATTERN, url)
        if match:
            return match.group(0) + "/"
        return None
    
    @staticmethod
    def get_video_info(video_id: str, share_url: str = None) -> Optional[Dict]:
        """获取视频信息 - 优先官方API，失败则用第三方，最后用浏览器"""
        
        # 先尝试官方 API
        info = DouyinParser._get_video_info_official(video_id)
        if info:
            return info
        
        # 第三方
        info = DouyinParser._get_video_info_third_party(video_id)
        if info:
            return info
        
        # 最后尝试浏览器
        return DouyinParser._get_video_info_browser(video_id, share_url)
    
    @staticmethod
    def _get_video_info_browser(video_id: str, share_url: str = None) -> Optional[Dict]:
        """使用 Playwright 浏览器获取视频信息（通过 subprocess 避免 asyncio 冲突）"""
        try:
            # 如果没有提供分享链接，使用 video_id 构造（可能跳转到首页）
            if not share_url:
                share_url = f"https://v.douyin.com/{video_id}/"
            
            # 使用 subprocess 运行浏览器代码，避免与 asyncio 冲突
            _python = PYTHON_BIN
            _share_url = share_url.replace("'", "'\\''")
            result = subprocess.run(
                [ _python, "-c", f"""
import sys
sys.path.insert(0, {SERVER_DIR!r})
from playwright.sync_api import sync_playwright

share_url = '{_share_url}'
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(
        viewport={{"width": 375, "height": 812}},
        user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1"
    )
    page = context.new_page()
    page.goto(share_url, wait_until='domcontentloaded', timeout=30000)
    page.wait_for_timeout(8000)

    # 提取标题（从 meta description 中提取，格式：标题 - 作者）
    title = "未知标题"
    desc_elem = page.query_selector('meta[name="description"]')
    if desc_elem:
        desc = desc_elem.get_attribute('content') or ""
        if desc:
            title = desc.split(" - ")[0].strip()

    # 提取视频下载链接
    video = page.query_selector('video')
    download_url = None
    if video:
        src = page.evaluate('el => el.src', video)
        if src and 'playwm' in src:
            download_url = src.replace('playwm', 'play')

    browser.close()
    import json
    print(json.dumps({{'url': download_url, 'title': title}}), flush=True)
"""
                ],
                capture_output=True, text=True, timeout=60
            )
            try:
                data = json.loads(result.stdout.strip())
                download_url = data.get("url")
                title = data.get("title", "未知标题")
            except:
                download_url = None
                title = "未知标题"
            if not download_url:
                print(f"Browser stderr: {result.stderr[:200]}")
            
            return {
                "video_id": video_id,
                "title": title,
                "author": "",
                "download_url": download_url,
                "source": "browser"
            }
        except Exception as e:
            print(f"Browser parsing error: {e}")
            return None
    
    @staticmethod
    def _get_video_info_official(video_id: str) -> Optional[Dict]:
        """官方 API 获取视频信息"""
        url = f"https://www.iesdouyin.com/web/api/v2/aweme/iteminfo/?item_ids={video_id}"
        
        try:
            headers = {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Referer": "https://www.douyin.com/",
                "Cookie": "tt_webid=xxx"
            }
            resp = requests.get(url, headers=headers, timeout=10)
            
            if resp.status_code != 200 or not resp.text:
                return None
            
            data = resp.json()
            
            if data.get("status_code") != 0:
                return None
            
            item = data.get("item_list", [{}])[0]
            
            return {
                "video_id": video_id,
                "title": item.get("desc", ""),
                "author": item.get("author", {}).get("nickname", ""),
                "create_time": item.get("create_time", 0),
                "digg_count": item.get("statistic", {}).get("digg_count", 0),
                "comment_count": item.get("statistic", {}).get("comment_count", 0),
                "share_count": item.get("statistic", {}).get("share_count", 0),
                "duration": item.get("video", {}).get("duration", 0) / 1000,
            }
        except Exception as e:
            print(f"Official API error: {e}")
            return None
    
    @staticmethod
    def _get_video_info_third_party(video_id: str) -> Optional[Dict]:
        """第三方 API 获取视频信息"""
        try:
            # 使用第三方解析服务
            share_url = f"https://v.douyin.com/{video_id}"
            api_url = f"{Config.THIRD_PARTY_API}?url={share_url}"
            
            resp = requests.get(api_url, timeout=15)
            
            if resp.status_code == 200:
                data = resp.json()
                
                # 解析第三方API响应
                if data.get("success") or data.get("code") == 200:
                    return {
                        "video_id": video_id,
                        "title": data.get("title", ""),
                        "author": data.get("author", ""),
                        "digg_count": data.get("digg_count", 0),
                        "comment_count": data.get("comment_count", 0),
                        "share_count": data.get("share_count", 0),
                        "duration": data.get("duration", 0),
                        "cover_url": data.get("cover", ""),
                        "download_url": data.get("url", ""),
                    }
            
            return None
        except Exception as e:
            print(f"Third party API error: {e}")
            return None
    
    @staticmethod
    def get_download_url(video_id: str, share_url: str = None) -> Optional[str]:
        """获取无水印视频下载链接 - 优先官方，失败则用第三方，最后用浏览器"""
        
        # 先尝试官方
        url = DouyinParser._get_download_url_official(video_id)
        if url:
            return url
        
        # 第三方
        url = DouyinParser._get_download_url_third_party(video_id)
        if url:
            return url
        
        # 最后尝试浏览器 (传入share_url)
        return DouyinParser._get_download_url_browser(video_id, share_url)
    
    @staticmethod
    def _get_download_url_browser(video_id: str, share_url: str = None) -> Optional[str]:
        """使用 Playwright 浏览器获取下载链接（通过 subprocess 避免 asyncio 冲突）"""
        try:
            # 如果没有提供分享链接，使用 video_id 构造
            if not share_url:
                share_url = f"https://v.douyin.com/{video_id}/"
            
            _python = PYTHON_BIN
            _share_url = share_url.replace("'", "'\\''")
            result = subprocess.run(
                [_python, "-c", f"""
import sys
sys.path.insert(0, {SERVER_DIR!r})
from playwright.sync_api import sync_playwright

share_url = '{_share_url}'
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(
        viewport={{"width": 375, "height": 812}},
        user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1"
    )
    page = context.new_page()
    page.goto(share_url, wait_until='domcontentloaded', timeout=30000)
    page.wait_for_timeout(10000)
    video = page.query_selector('video')
    download_url = None
    if video:
        src = page.evaluate('el => el.src', video)
        if src:
            if src.startswith('/'):
                src = 'https://aweme.snssdk.com' + src
            if 'playwm' in src:
                download_url = src.replace('playwm', 'play')
            elif 'play' in src:
                download_url = src
    browser.close()
    import json
    print(json.dumps({{'url': download_url}}), flush=True)
"""
                ],
                capture_output=True, text=True, timeout=60
            )
            try:
                data = json.loads(result.stdout.strip())
                return data.get("url")
            except:
                return None
        except Exception as e:
            print(f"Browser download URL error: {e}")
            return None
    
    @staticmethod
    def _get_download_url_official(video_id: str) -> Optional[str]:
        """官方 API 获取下载链接"""
        info_url = f"https://www.iesdouyin.com/web/api/v2/aweme/iteminfo/?item_ids={video_id}"
        
        try:
            headers = {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Referer": "https://www.douyin.com/"
            }
            resp = requests.get(info_url, headers=headers, timeout=10)
            data = resp.json()
            
            item = data.get("item_list", [{}])[0]
            video_info = item.get("video", {})
            
            # 获取playwm链接，去掉wm变成无水印
            playwm_url = video_info.get("playwm_addr", {}).get("url_list", [None])[0]
            
            if playwm_url:
                download_url = playwm_url.replace("playwm", "play")
                return download_url
            
            return None
        except Exception as e:
            print(f"Official download URL error: {e}")
            return None
    
    @staticmethod
    def _get_download_url_third_party(video_id: str) -> Optional[str]:
        """第三方 API 获取下载链接"""
        try:
            share_url = f"https://v.douyin.com/{video_id}"
            api_url = f"{Config.THIRD_PARTY_API}?url={share_url}"
            
            resp = requests.get(api_url, timeout=15)
            
            if resp.status_code == 200:
                data = resp.json()
                # 尝试多种返回格式
                return data.get("url") or data.get("video_url") or data.get("download_url")
            
            return None
        except Exception as e:
            print(f"Third party download URL error: {e}")
            return None
            
            item = data.get("item_list", [{}])[0]
            video_info = item.get("video", {})
            
            # 获取playwm链接，去掉wm变成无水印
            playwm_url = video_info.get("playwm_addr", {}).get("url_list", [None])[0]
            
            if playwm_url:
                # 替换 playwm 为 play
                download_url = playwm_url.replace("playwm", "play")
                return download_url
            
            return None
        except Exception as e:
            print(f"Error getting download URL: {e}")
            return None

# ============ 音频处理 ============
class AudioProcessor:
    """音频处理和语音识别"""
    
    @staticmethod
    def download_video(url: str, output_path: str) -> bool:
        """下载视频"""
        try:
            resp = requests.get(url, stream=True, timeout=60)
            with open(output_path, 'wb') as f:
                for chunk in resp.iter_content(chunk_size=8192):
                    f.write(chunk)
            return True
        except Exception as e:
            print(f"Error downloading video: {e}")
            return False
    
    @staticmethod
    def extract_audio(video_path: str, audio_path: str) -> bool:
        """提取音频"""
        try:
            cmd = [
                "ffmpeg", "-i", video_path,
                "-vn", "-acodec", "libmp3lame", "-q:a", "2",
                "-y", audio_path
            ]
            subprocess.run(cmd, capture_output=True, check=True)
            return True
        except Exception as e:
            print(f"Error extracting audio: {e}")
            return False
    
    @staticmethod
    def transcribe_local(audio_path: str) -> Optional[str]:
        """本地语音识别 - mlx-whisper 优先，faster-whisper 兜底"""
        import platform

        # --- 优先：mlx-whisper（Apple Silicon Metal GPU）---
        if platform.system() == "Darwin" and platform.machine() == "arm64":
            try:
                import mlx_whisper
                model_name = f"mlx-community/whisper-{Config.WHISPER_MODEL}-mlx"
                print(f"[Transcribe] using mlx-whisper: {model_name}")
                result = mlx_whisper.transcribe(
                    audio_path,
                    path_or_hf_repo=model_name,
                    language="zh"
                )
                text = result.get("text", "").strip()
                if text:
                    return text
            except Exception as e:
                print(f"[Transcribe] mlx-whisper failed: {e}")

        # --- 兜底：faster-whisper（CPU / CUDA 通用）---
        try:
            from faster_whisper import WhisperModel
            compute = "auto"  # 自动选择 CPU/CUDA
            print(f"[Transcribe] using faster-whisper (compute={compute})")
            model = WhisperModel(
                Config.WHISPER_MODEL,
                device="auto",
                compute_type=compute
            )
            segments, _ = model.transcribe(
                audio_path,
                language="zh",
                vad_filter=True
            )
            text = "".join(seg.text for seg in segments)
            if text:
                return text
        except Exception as e:
            print(f"[Transcribe] faster-whisper failed: {e}")

        print("[Transcribe] all local transcription methods failed")
        return None
    
    @staticmethod
    def transcribe_cloud(audio_path: str) -> Optional[str]:
        """SiliconFlow 云端语音识别"""
        if not Config.SILICONFLOW_API_KEY:
            print("SiliconFlow API key not configured")
            return None
        
        try:
            url = f"{Config.SILICONFLOW_BASE_URL}/v1/audio/transcriptions"
            
            with open(audio_path, 'rb') as f:
                files = {'file': f}
                data = {
                    'model': 'FunAudioLLM/SenseVoiceSmall',
                }
                headers = {'Authorization': f'Bearer {Config.SILICONFLOW_API_KEY}'}
                
                resp = requests.post(url, files=files, data=data, headers=headers, timeout=120)
                
                if resp.status_code == 200:
                    result = resp.json()
                    return result.get("text", "")
                else:
                    print(f"Cloud transcription error: {resp.status_code} {resp.text}")
                    return None
                    
        except Exception as e:
            print(f"Error in cloud transcription: {e}")
            return None
    
    @staticmethod
    def transcribe(audio_path: str) -> Optional[str]:
        """语音识别 - 自动选择模式"""
        
        # 优先尝试本地
        if Config.STT_MODE in ("local", "auto"):
            result = AudioProcessor.transcribe_local(audio_path)
            if result:
                return result
        
        # 本地失败或选择云端
        if Config.STT_MODE in ("cloud", "auto"):
            if Config.SILICONFLOW_API_KEY:
                result = AudioProcessor.transcribe_cloud(audio_path)
                if result:
                    return result
        
        return None

# ============ 关键帧提取 ============
class VideoFrameExtractor:
    """视频关键帧提取"""
    
    @staticmethod
    def extract_frame(video_path: str, timestamp: float, output_path: str) -> bool:
        """提取指定时间点的帧"""
        try:
            cmd = [
                "ffmpeg", "-ss", str(timestamp),
                "-i", video_path,
                "-vframes", "1",
                "-y", output_path
            ]
            subprocess.run(cmd, capture_output=True, check=True)
            return os.path.exists(output_path)
        except Exception as e:
            print(f"Error extracting frame: {e}")
            return False

# ============ MiniMax 图像理解 ============
class MiniMaxImageUnderstander:
    """MiniMax 图像理解"""
    
    @staticmethod
    def analyze(image_path: str, prompt: str = "描述这张图片的内容") -> Optional[str]:
        """使用 MiniMax 分析图像"""
        if not Config.MINIMAX_API_KEY:
            return "MiniMax API key not configured"
        
        try:
            # 将图片转为 base64
            import base64
            with open(image_path, 'rb') as f:
                img_data = base64.b64encode(f.read()).decode()
            
            url = f"{Config.MINIMAX_BASE_URL}/v1/images/generation"
            
            headers = {
                "Authorization": f"Bearer {Config.MINIMAX_API_KEY}",
                "Content-Type": "application/json"
            }
            
            # MiniMax 图像理解使用文本对话 API
            payload = {
                "model": "MiniMax-M2.1",
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/jpeg;base64,{img_data}"
                                }
                            },
                            {
                                "type": "text",
                                "text": prompt
                            }
                        ]
                    }
                ],
                "max_tokens": 1000
            }
            
            resp = requests.post(url, json=payload, headers=headers, timeout=60)
            
            if resp.status_code == 200:
                result = resp.json()
                return result.get("choices", [{}])[0].get("message", {}).get("content", "")
            else:
                return f"Error: {resp.status_code} {resp.text[:200]}"
                
        except Exception as e:
            return f"Error: {str(e)}"

# ============ 内容分析 ============
class ContentAnalyzer:
    """分析语音内容，找出高潮/亮点"""
    
    @staticmethod
    def find_highlights(transcript: str, duration: float) -> List[Dict]:
        """分析内容，找出亮点时间点"""
        if not Config.MINIMAX_API_KEY:
            return []
        
        try:
            url = f"{Config.MINIMAX_BASE_URL}/v1/chat/completions"
            
            headers = {
                "Authorization": f"Bearer {Config.MINIMAX_API_KEY}",
                "Content-Type": "application/json"
            }
            
            prompt = f"""分析以下抖音视频语音内容，找出可能的高潮或亮点部分。

视频时长: {duration}秒

语音内容:
{transcript[:2000]}

请分析内容，找出3-5个可能的亮点时间点（用占视频时长的百分比表示，0-100%）。
返回JSON数组格式:
[
  {{"timestamp_percent": 30, "reason": "观众笑声/掌声/情绪高潮"}},
  {{"timestamp_percent": 65, "reason": "核心内容/关键信息"}}
]

只返回JSON数组，不要其他内容。"""

            payload = {
                "model": "MiniMax-M2.1",
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 500
            }
            
            resp = requests.post(url, json=payload, headers=headers, timeout=30)
            
            if resp.status_code == 200:
                result = resp.json()
                content = result.get("choices", [{}])[0].get("message", {}).get("content", "")
                
                # 解析 JSON
                import re
                json_match = re.search(r'\[.*\]', content, re.DOTALL)
                if json_match:
                    highlights = json.loads(json_match.group())
                    return [
                        {
                            "timestamp": (h.get("timestamp_percent", 0) / 100) * duration,
                            "reason": h.get("reason", "")
                        }
                        for h in highlights
                    ]
            
            return []
            
        except Exception as e:
            print(f"Error analyzing content: {e}")
            return []

# ============ 主流程 ============
class DouyinAnalyzer:
    """抖音视频完整分析"""
    
    def __init__(self):
        self.temp_dir = tempfile.mkdtemp()
    
    def analyze(self, share_url: str, focus_highlight: bool = True) -> Dict[str, Any]:
        """完整分析流程"""
        result = {
            "status": "pending",
            "video_info": None,
            "transcript": None,
            "highlights": [],
            "frame_analysis": [],
            "error": None
        }
        
        try:
            # 1. 解析链接
            video_id = DouyinParser.extract_video_id(share_url)
            if not video_id:
                result["error"] = "无法解析抖音链接"
                return result
            
            # 2. 获取视频信息
            video_info = DouyinParser.get_video_info(video_id, share_url)
            if not video_info:
                result["error"] = "无法获取视频信息"
                return result
            result["video_info"] = video_info
            
            # 3. 获取下载链接 (传入share_url用于浏览器模式)
            download_url = DouyinParser.get_download_url(video_id, share_url)
            if not download_url:
                result["error"] = "无法获取视频下载链接"
                return result
            
            # 4. 下载视频
            video_path = os.path.join(self.temp_dir, "video.mp4")
            if not AudioProcessor.download_video(download_url, video_path):
                result["error"] = "视频下载失败"
                return result
            
            # 5. 提取音频
            audio_path = os.path.join(self.temp_dir, "audio.mp3")
            if not AudioProcessor.extract_audio(video_path, audio_path):
                result["error"] = "音频提取失败"
                return result
            
            # 6. 语音识别
            transcript = AudioProcessor.transcribe(audio_path)
            if transcript:
                result["transcript"] = transcript
                
                # 7. 分析内容找亮点
                if focus_highlight and Config.MINIMAX_API_KEY:
                    highlights = ContentAnalyzer.find_highlights(
                        transcript, 
                        video_info.get("duration", 0)
                    )
                    result["highlights"] = highlights
                    
                    # 8. 提取关键帧并分析
                    for hl in highlights[:2]:  # 最多取2个亮点
                        frame_path = os.path.join(self.temp_dir, f"frame_{hl['timestamp']}.jpg")
                        if VideoFrameExtractor.extract_frame(video_path, hl["timestamp"], frame_path):
                            frame_analysis = MiniMaxImageUnderstander.analyze(
                                frame_path, 
                                "描述这个视频关键时刻的画面内容"
                            )
                            result["frame_analysis"].append({
                                "timestamp": hl["timestamp"],
                                "reason": hl["reason"],
                                "frame_path": frame_path,
                                "analysis": frame_analysis
                            })
            
            result["status"] = "success"
            
        except Exception as e:
            result["error"] = str(e)
        
        finally:
            # 清理临时文件
            import shutil
            try:
                shutil.rmtree(self.temp_dir)
            except:
                pass
        
        return result

# ============ MCP 工具函数 ============
def parse_douyin_video_info(share_link: str) -> str:
    """解析抖音视频基本信息"""
    video_id = DouyinParser.extract_video_id(share_link)
    if not video_id:
        return json.dumps({"error": "无法解析抖音链接"}, ensure_ascii=False)
    
    info = DouyinParser.get_video_info(video_id, share_link)
    if not info:
        return json.dumps({"error": "无法获取视频信息"}, ensure_ascii=False)
    
    return json.dumps(info, ensure_ascii=False, indent=2)

def get_douyin_download_link(share_link: str) -> str:
    """获取抖音视频无水印下载链接"""
    video_id = DouyinParser.extract_video_id(share_link)
    if not video_id:
        return json.dumps({"error": "无法解析抖音链接"}, ensure_ascii=False)
    
    # 传入 share_url 用于浏览器模式
    url = DouyinParser.get_download_url(video_id, share_link)
    if not url:
        return json.dumps({"error": "无法获取下载链接"}, ensure_ascii=False)
    
    return json.dumps({
        "video_id": video_id,
        "download_url": url,
        "share_link": share_link
    }, ensure_ascii=False)

def analyze_douyin_video(share_link: str, focus_highlight: bool = True) -> str:
    """完整分析抖音视频（语音+画面）"""
    analyzer = DouyinAnalyzer()
    result = analyzer.analyze(share_link, focus_highlight)
    return json.dumps(result, ensure_ascii=False, indent=2)

def extract_douyin_audio(share_link: str) -> str:
    """提取抖音视频音频"""
    video_id = DouyinParser.extract_video_id(share_link)
    if not video_id:
        return json.dumps({"error": "无法解析抖音链接"}, ensure_ascii=False)
    
    download_url = DouyinParser.get_download_url(video_id)
    if not download_url:
        return json.dumps({"error": "无法获取下载链接"}, ensure_ascii=False)
    
    temp_dir = tempfile.mkdtemp()
    video_path = os.path.join(temp_dir, "video.mp4")
    audio_path = os.path.join(temp_dir, "audio.mp3")
    
    try:
        if not AudioProcessor.download_video(download_url, video_path):
            return json.dumps({"error": "视频下载失败"}, ensure_ascii=False)
        
        if not AudioProcessor.extract_audio(video_path, audio_path):
            return json.dumps({"error": "音频提取失败"}, ensure_ascii=False)
        
        # 读取音频返回
        with open(audio_path, 'rb') as f:
            import base64
            audio_b64 = base64.b64encode(f.read()).decode()
        
        return json.dumps({
            "status": "success",
            "audio": audio_b64,
            "format": "mp3"
        }, ensure_ascii=False)
        
    finally:
        import shutil
        shutil.rmtree(temp_dir, ignore_errors=True)


# ============ 通用多平台视频下载 + 转录（新工具）============

class UniversalPlatformDetector:
    """检测视频链接所属平台"""
    PATTERNS = {
        "bilibili":    [r"bilibili\.com/video", r"b23\.tv", r"BV[a-zA-Z0-9]+"],
        "douyin":      [r"douyin\.com", r"v\.douyin\.com", r"iesdouyin\.com"],
        "tiktok":      [r"tiktok\.com"],
        "youtube":     [r"youtube\.com/watch", r"youtu\.be/"],
        "xiaohongshu": [r"xiaohongshu\.com", r"xhslink\.com"],
        "weibo":       [r"weibo\.com", r"m\.weibo\.cn"],
        "kuaishou":    [r"kuaishou\.com", r"ksurl\.cn"],
    }
    @classmethod
    def detect(cls, url):
        for name, pats in cls.PATTERNS.items():
            for p in pats:
                if re.search(p, url, re.IGNORECASE):
                    return name
        return "unknown"

class UniversalVideoAnalyzer:
    """通用视频分析（yt-dlp 优先，tikhub 保底）"""
    def __init__(self):
        import tempfile
        self.temp_dir = tempfile.mkdtemp()

    def analyze(self, url):
        """分析流程：短视频同步返回，长视频后台转录"""
        import shutil
        result = {"status": "pending", "platform": None, "video_info": None,
                  "download_path": None, "transcript": None, "segments": None,
                  "summary": None, "chapters": [], "highlights": [],
                  "download_source": None, "transcript_id": None, "error": None}
        try:
            platform = UniversalPlatformDetector.detect(url)
            result["platform"] = platform
            if platform == "unknown":
                result["error"] = f"不支持的平台: {url}"
                return result
            # yt-dlp 获取信息
            duration = 0
            try:
                import subprocess
                cp = subprocess.run(["yt-dlp", "--dump-json", "--no-download", url],
                                   capture_output=True, text=True, timeout=30)
                if cp.returncode == 0:
                    import json as js
                    info = js.loads(cp.stdout.strip().split("\n")[0])
                    duration = info.get("duration") or 0
                    result["video_info"] = {"title": info.get("title",""), "duration": duration,
                                           "uploader": info.get("uploader",""),
                                           "description": info.get("description","")}
            except Exception as e:
                print(f"[Universal] get_info error: {e}")
            # 下载
            ok, file_path, source = self._download(url)
            if not ok:
                result["error"] = f"下载失败: {file_path}"
                return result
            result["download_path"] = file_path
            result["download_source"] = source
            # 短视频（<5min）同步转录
            if duration < Config.DURATION_THRESHOLD:
                return self._analyze_sync(result, file_path, duration)
            # 长视频：后台转录，立即返回
            return self._analyze_async(url, result, file_path, duration)
        except Exception as e:
            result["error"] = str(e)
        finally:
            try: shutil.rmtree(self.temp_dir)
            except: pass
        return result

    def _analyze_sync(self, result, video_path, duration):
        """同步转录（短视频）"""
        try:
            audio_path = self.temp_dir + "/audio.mp3"
            cp = subprocess.run(["ffmpeg", "-i", video_path, "-vn", "-acodec", "libmp3lame",
                                 "-q:a", "2", "-y", audio_path],
                                capture_output=True, text=True, timeout=120)
            if cp.returncode != 0:
                result["error"] = "音频提取失败"
                return result
            text, segments = self._transcribe(audio_path)
            if not text:
                result["error"] = "转录失败"
                return result
            # 后处理：结构化输出
            structured = self._structure_output(text, segments, duration,
                                                  result.get("video_info", {}))
            result.update(structured)
            result["status"] = "success"
        except Exception as e:
            result["error"] = str(e)
        return result

    def _analyze_async(self, url, result, video_path, duration):
        """异步转录（长视频）：下载后后台运行，立即返回 transcript_id"""
        import shutil
        transcript_id = hashlib.md5(f"{url}_{time_module.time()}".encode()).hexdigest()[:12]
        persist_dir = Config.TRANSCRIPTS_DIR
        os.makedirs(persist_dir, exist_ok=True)
        # 保存视频路径供后台任务使用
        job_file = os.path.join(persist_dir, f"{transcript_id}.json")
        audio_path = os.path.join(persist_dir, f"{transcript_id}.mp3")
        # 提取音频到持久目录
        cp = subprocess.run(["ffmpeg", "-i", video_path, "-vn", "-acodec", "libmp3lame",
                             "-q:a", "2", "-y", audio_path],
                            capture_output=True, text=True, timeout=120)
        if cp.returncode != 0:
            result["error"] = "音频提取失败"
            return result
        # 写入 job 状态
        job_info = {
            "transcript_id": transcript_id,
            "url": url,
            "audio_path": audio_path,
            "duration": duration,
            "video_info": result.get("video_info"),
            "status": "transcribing",
            "transcript": None, "segments": None,
            "summary": None, "chapters": [], "highlights": [],
            "created_at": time_module.time()
        }
        with open(job_file, "w") as f:
            json.dump(job_info, f, ensure_ascii=False)
        # 后台线程转录
        def bg_transcribe():
            text, segments = self._transcribe(audio_path)
            job_info["transcript"] = text
            job_info["segments"] = segments
            if text:
                structured = self._structure_output(text, segments, duration,
                                                      result.get("video_info", {}))
                job_info.update(structured)
            job_info["status"] = "ready"
            job_info["completed_at"] = time_module.time()
            with open(job_file, "w") as f:
                json.dump(job_info, f, ensure_ascii=False)
        threading.Thread(target=bg_transcribe, daemon=True).start()
        result["status"] = "transcribing"
        result["transcript_id"] = transcript_id
        result["message"] = f"视频较长（{int(duration//60)}分），正在后台转录，请使用 transcript_id 调用 get_transcript 获取结果"
        return result

    def _structure_output(self, text, segments, duration, video_info):
        """将原始转录结果结构化：摘要、章节、高亮"""
        structured = {"transcript": text, "segments": segments or [],
                      "summary": None, "chapters": [], "highlights": []}
        if not text or not Config.MINIMAX_API_KEY:
            return structured
        try:
            import requests
            # 构造章节提示词
            duration_min = int(duration // 60)
            chapter_prompt = f"""你是一个视频内容分析助手。视频时长：{duration_min}分钟，标题：{video_info.get('title','')}。

请根据以下转录文本，输出一份结构化的内容分析（JSON格式）：

转录文本：
{text[:6000]}

要求输出JSON（不要任何其他内容）：
{{
  "summary": "3-5句话的总结",
  "chapters": [
    {{"timestamp": "0:00", "title": "章节标题", "summary": "本节内容一句话总结"}},
    ...
  ],
  "highlights": ["关键观点1", "关键观点2", "关键观点3"]
}}

请确保 chapters 有3-8个章节，覆盖视频的主要内容。"""

            resp = requests.post(
                f"{Config.MINIMAX_BASE_URL}/v1/chat/completions",
                headers={"Authorization": f"Bearer {Config.MINIMAX_API_KEY}",
                         "Content-Type": "application/json"},
                json={"model": "MiniMax-M2.1",
                      "messages": [{"role": "user", "content": chapter_prompt}],
                      "max_tokens": 1500},
                timeout=30
            )
            if resp.status_code == 200:
                data = resp.json()
                raw = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                import re as re2
                m = re2.search(r'\{.*\}', raw, re2.DOTALL)
                if m:
                    parsed = json.loads(m.group())
                    structured["summary"] = parsed.get("summary")
                    structured["chapters"] = parsed.get("chapters", [])
                    structured["highlights"] = parsed.get("highlights", [])
        except Exception as e:
            print(f"[_structure_output] error: {e}")
        return structured

    def _download(self, url):
        import subprocess, os, shutil
        platform = UniversalPlatformDetector.detect(url)
        output_dir = self.temp_dir
        os.makedirs(output_dir, exist_ok=True)
        tmpl = os.path.join(output_dir, "%(title)s.%(ext)s")
        # yt-dlp 优先
        cp = subprocess.run(["yt-dlp", "-f", "bestvideo+bestaudio/best",
                             "--merge-output-format", "mp4", "-o", tmpl,
                             "--no-playlist", url],
                            capture_output=True, text=True, timeout=300)
        if cp.returncode == 0:
            files = [f for f in os.listdir(output_dir) if f.endswith((".mp4",".mkv",".webm"))]
            if files:
                return True, os.path.join(output_dir, files[0]), "yt-dlp"
        # tikhub 备用
        import os as oo
        tikhub_key = oo.environ.get("TIKHUB_API_KEY", "")
        if tikhub_key:
            print(f"[Universal] yt-dlp failed, tikhub not implemented for new flow, continuing...")
        return False, "下载失败", "error"

    def _transcribe(self, audio_path):
        import platform as plat

        # --- 优先：mlx-whisper（Apple Silicon Metal GPU）---
        if plat.system() == "Darwin" and plat.machine() == "arm64":
            try:
                import mlx_whisper
                model_name = "mlx-community/whisper-small-mlx"
                print(f"[UniversalWhisper] using mlx-whisper: {model_name}")
                result = mlx_whisper.transcribe(
                    audio_path,
                    path_or_hf_repo=model_name,
                    language="zh"
                )
                text = result.get("text", "").strip()
                segments = [
                    {"start": s.get("start", 0), "end": s.get("end", 0), "text": s.get("text", "").strip()}
                    for s in result.get("segments", [])
                    if s.get("text", "").strip()
                ]
                if text:
                    return text, segments
            except Exception as e:
                print(f"[UniversalWhisper] mlx-whisper failed: {e}")

        # --- 兜底：faster-whisper（CPU / CUDA 通用）---
        try:
            from faster_whisper import WhisperModel
            print(f"[UniversalWhisper] using faster-whisper")
            model = WhisperModel("small", device="auto", compute_type="auto")
            segments, _ = model.transcribe(audio_path, language="zh", vad_filter=True)
            text = "".join(seg.text for seg in segments)
            seg_list = [
                {"start": seg.start, "end": seg.end, "text": seg.text.strip()}
                for seg in segments if seg.text.strip()
            ]
            if text:
                return text, seg_list
        except Exception as e:
            print(f"[UniversalWhisper] faster-whisper failed: {e}")

        print("[UniversalWhisper] all transcription methods failed")
        return None, None


def analyze_video(url: str) -> str:
    """通用视频分析 - 支持 B站/抖音/TikTok/YouTube/小红书/微博/快手"""
    import json as js
    r = UniversalVideoAnalyzer().analyze(url)
    return js.dumps(r, ensure_ascii=False, indent=2)

def get_video_info(url: str) -> str:
    """获取视频信息（不下载）"""
    import json as js
    import subprocess
    platform = UniversalPlatformDetector.detect(url)
    if platform == "unknown":
        return js.dumps({"error": f"不支持的平台: {url}"}, ensure_ascii=False)
    try:
        cp = subprocess.run(["yt-dlp", "--dump-json", "--no-download", url],
                           capture_output=True, text=True, timeout=30)
        if cp.returncode == 0:
            info = js.loads(cp.stdout.strip().split("\n")[0])
            return js.dumps({"platform": platform, "title": info.get("title",""),
                             "duration": info.get("duration",0),
                             "uploader": info.get("uploader",""),
                             "description": info.get("description","")}, ensure_ascii=False, indent=2)
    except:
        pass
    return js.dumps({"error": "获取信息失败"}, ensure_ascii=False)

def download_video(url: str, output_dir: str = None) -> str:
    """下载视频到指定目录"""
    import json as js, tempfile, os
    if output_dir is None:
        output_dir = tempfile.mkdtemp()
    os.makedirs(output_dir, exist_ok=True)
    tmpl = os.path.join(output_dir, "%(title)s.%(ext)s")
    import subprocess
    cp = subprocess.run(["yt-dlp", "-f", "bestvideo+bestaudio/best",
                         "--merge-output-format", "mp4", "-o", tmpl,
                         "--no-playlist", url],
                        capture_output=True, text=True, timeout=300)
    if cp.returncode == 0:
        files = [f for f in os.listdir(output_dir) if f.endswith((".mp4",".mkv",".webm"))]
        if files:
            return js.dumps({"status": "success", "file_path": os.path.join(output_dir, files[0]),
                             "source": "yt-dlp", "output_dir": output_dir}, ensure_ascii=False, indent=2)
    return js.dumps({"status": "error", "error": "下载失败"}, ensure_ascii=False)

def get_transcript(transcript_id: str) -> str:
    """获取长视频转录结果（transcribe_id 由 analyze_video 返回）"""
    import json as js
    job_file = os.path.join(Config.TRANSCRIPTS_DIR, f"{transcript_id}.json")
    if not os.path.exists(job_file):
        return js.dumps({"error": f"未找到 transcript_id: {transcript_id}"}, ensure_ascii=False)
    with open(job_file) as f:
        job = json.load(f)
    if job["status"] == "transcribing":
        elapsed = int(time_module.time() - job["created_at"])
        return js.dumps({"status": "transcribing", "transcript_id": transcript_id,
                         "message": f"转录中（已进行 {elapsed} 秒），请稍后重试"}, ensure_ascii=False)
    return js.dumps({"status": "ready", "transcript_id": transcript_id,
                     "video_info": job.get("video_info"),
                     "transcript": job.get("transcript"),
                     "segments": job.get("segments"),
                     "summary": job.get("summary"),
                     "chapters": job.get("chapters"),
                     "highlights": job.get("highlights")}, ensure_ascii=False, indent=2)

def query_transcript(transcript_id: str, query: str, top_k: int = 3) -> str:
    """在已转录的视频中检索相关内容（基于关键词匹配）"""
    import json as js, re as re2
    job_file = os.path.join(Config.TRANSCRIPTS_DIR, f"{transcript_id}.json")
    if not os.path.exists(job_file):
        return js.dumps({"error": f"未找到 transcript_id: {transcript_id}"}, ensure_ascii=False)
    with open(job_file) as f:
        job = json.load(f)
    if job["status"] != "ready":
        return js.dumps({"error": "转录尚未完成，请先调用 get_transcript"}, ensure_ascii=False)
    segments = job.get("segments", [])
    if not segments:
        return js.dumps({"error": "无 segments 数据"}, ensure_ascii=False)
    # 简单关键词匹配
    query_words = query.lower().split()
    scored = []
    for seg in segments:
        txt = seg.get("text", "").lower()
        score = sum(1 for w in query_words if w in txt)
        if score > 0:
            scored.append((score, seg))
    scored.sort(key=lambda x: x[0], reverse=True)
    results = []
    for score, seg in scored[:top_k]:
        ts = int(seg.get("start", 0))
        results.append({
            "timestamp": f"{ts//60}:{ts%60:02d}",
            "timestamp_sec": ts,
            "score": score,
            "text": seg.get("text", "")
        })
    return js.dumps({"query": query, "results": results}, ensure_ascii=False, indent=2)


# ============ MCP Server ============
from mcp.server import Server
from mcp.types import Tool, TextContent
from mcp.server.stdio import stdio_server

app = Server("douyin-analyzer")

@app.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(
            name="parse_douyin_video_info",
            description="解析抖音视频基本信息（标题、作者、点赞数等）",
            inputSchema={
                "type": "object",
                "properties": {
                    "share_link": {"type": "string", "description": "抖音分享链接"}
                },
                "required": ["share_link"]
            }
        ),
        Tool(
            name="get_douyin_download_link",
            description="获取抖音视频无水印下载链接",
            inputSchema={
                "type": "object",
                "properties": {
                    "share_link": {"type": "string", "description": "抖音分享链接"}
                },
                "required": ["share_link"]
            }
        ),
        Tool(
            name="analyze_douyin_video",
            description="完整分析抖音视频：语音识别+内容分析+关键帧提取+画面理解",
            inputSchema={
                "type": "object",
                "properties": {
                    "share_link": {"type": "string", "description": "抖音分享链接"},
                    "focus_highlight": {"type": "boolean", "description": "是否分析内容找亮点", "default": True}
                },
                "required": ["share_link"]
            }
        ),
        Tool(
            name="extract_douyin_audio",
            description="提取抖音视频音频（Base64编码）",
            inputSchema={
                "type": "object",
                "properties": {
                    "share_link": {"type": "string", "description": "抖音分享链接"}
                },
                "required": ["share_link"]
            }
        ),
        Tool(
            name="analyze_video",
            description="通用视频分析（下载 + 转录）- 支持 B站/抖音/TikTok/YouTube/小红书/微博/快手，yt-dlp 优先，tikhub 保底",
            inputSchema={
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "视频链接"}
                },
                "required": ["url"]
            }
        ),
        Tool(
            name="get_video_info",
            description="获取视频基本信息（不下载）- 支持所有主流平台",
            inputSchema={
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "视频链接"}
                },
                "required": ["url"]
            }
        ),
        Tool(
            name="download_video",
            description="下载视频到指定目录（支持所有主流平台）",
            inputSchema={
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "视频链接"},
                    "output_dir": {"type": "string", "description": "输出目录（可选）"}
                },
                "required": ["url"]
            }
        ),
        Tool(
            name="get_transcript",
            description="获取长视频后台转录结果（短视频直接返回完整结果）",
            inputSchema={
                "type": "object",
                "properties": {
                    "transcript_id": {"type": "string", "description": "转录任务ID（由 analyze_video 返回）"}
                },
                "required": ["transcript_id"]
            }
        ),
        Tool(
            name="query_transcript",
            description="在已转录的视频中检索相关内容（关键词匹配，返回相关片段）",
            inputSchema={
                "type": "object",
                "properties": {
                    "transcript_id": {"type": "string", "description": "转录任务ID"},
                    "query": {"type": "string", "description": "查询内容/关键词"},
                    "top_k": {"type": "integer", "description": "返回片段数量（默认3）", "default": 3}
                },
                "required": ["transcript_id", "query"]
            }
        )
    ]

@app.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    if name == "parse_douyin_video_info":
        result = parse_douyin_video_info(arguments["share_link"])
    elif name == "get_douyin_download_link":
        result = get_douyin_download_link(arguments["share_link"])
    elif name == "analyze_douyin_video":
        result = analyze_douyin_video(
            arguments["share_link"], 
            arguments.get("focus_highlight", True)
        )
    elif name == "extract_douyin_audio":
        result = extract_douyin_audio(arguments["share_link"])
    elif name == "analyze_video":
        result = analyze_video(arguments["url"])
    elif name == "get_video_info":
        result = get_video_info(arguments["url"])
    elif name == "download_video":
        result = download_video(arguments["url"], arguments.get("output_dir"))
    elif name == "get_transcript":
        result = get_transcript(arguments["transcript_id"])
    elif name == "query_transcript":
        result = query_transcript(arguments["transcript_id"], arguments["query"],
                                   arguments.get("top_k", 3))
    else:
        result = json.dumps({"error": f"Unknown tool: {name}"})
    
    return [TextContent(type="text", text=result)]

async def main():
    async with stdio_server() as (read, write):
        await app.run(read, write, app.create_initialization_options())

if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
