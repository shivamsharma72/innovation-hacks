import requests
from flask import Flask, request, jsonify, render_template
import google.generativeai as genai
import json
import os

# Get the directory of the current file
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TEMPLATE_DIR = os.path.join(BASE_DIR, 'templates')

app = Flask(__name__, template_folder=TEMPLATE_DIR)

# Canvas LMS Configuration (use environment variables for production)
from dotenv import load_dotenv

load_dotenv()

CANVAS_URL = os.getenv("CANVAS_URL", "https://canvas.asu.edu")
CANVAS_ACCESS_TOKEN = os.getenv("CANVAS_ACCESS_TOKEN", "")

# Gemini API Configuration (use environment variables for production)
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)
else:
    print("WARNING: GEMINI_API_KEY not set. Set it before using the chatbot.")

# Helper function to query Canvas API
def query_canvas_api(endpoint, params=None):
    """Query Canvas API directly"""
    headers = {
        "Authorization": f"Bearer {CANVAS_ACCESS_TOKEN}",
        "Content-Type": "application/json"
    }
    url = f"{CANVAS_URL}/api/v1/{endpoint}"
    print(f"Requesting Canvas API: {url} with params: {params}")  # Debug log
    response = requests.get(url, headers=headers, params=params)
    print(f"Response status: {response.status_code}")  # Debug log
    if response.status_code == 200:
        return response.json()
    else:
        print(f"Error response: {response.text}")  # Debug log
        return {"error": response.text}

# Helper function to get all Canvas data for the student
def get_student_canvas_data():
    """Fetch all relevant Canvas data for the student"""
    data = {}
    
    # Get courses
    courses_response = query_canvas_api("users/self/courses", {"enrollment_state": "active"})
    if isinstance(courses_response, list):
        courses = []
        for course in courses_response:
            course_data = {
                "id": course.get("id"),
                "name": course.get("name"),
                "code": course.get("course_code")
            }
            
            # Get grades for this course
            enrollments = query_canvas_api(f"courses/{course['id']}/enrollments", {"user_id": "self"})
            if isinstance(enrollments, list) and len(enrollments) > 0:
                course_data["grade"] = enrollments[0].get("grades", {}).get("current_grade", "N/A")
            
            # Get assignments for this course
            assignments_response = query_canvas_api(f"courses/{course['id']}/assignments", {"order_by": "due_at"})
            if isinstance(assignments_response, list):
                course_data["assignments"] = [
                    {
                        "name": a.get("name"),
                        "due_at": a.get("due_at"),
                        "submitted": a.get("submission", {}).get("submitted_at") is not None if isinstance(a.get("submission"), dict) else False
                    }
                    for a in assignments_response if a.get("due_at")
                ]
            
            courses.append(course_data)
        
        data["courses"] = courses
    
    return data

# Helper function to use Gemini for intelligent responses
def ask_gemini(user_question, canvas_data):
    """Ask Gemini AI a question about Canvas data"""
    try:
        model = genai.GenerativeModel('models/gemini-2.5-flash')
        
        # Prepare context with Canvas data
        context = f"""You are a helpful student assistant chatbot. Here is the student's Canvas data:

{json.dumps(canvas_data, indent=2)}

Student's question: {user_question}

Please answer the student's question in a friendly, conversational way. Use the Canvas data provided to give accurate answers. Keep responses concise but helpful."""
        
        response = model.generate_content(context)
        return response.text
    except Exception as e:
        print(f"Gemini API Error: {str(e)}")
        return f"Sorry, I encountered an error: {str(e)}"

# Route to handle chatbot queries
@app.route("/chat", methods=["POST"])
def chat():
    try:
        user_input = request.json.get("message")
        
        if not user_input:
            return jsonify({"response": "Please provide a message."})
        
        # Fetch Canvas data
        print("Fetching Canvas data...")
        canvas_data = get_student_canvas_data()
        
        # Use Gemini to answer the question
        print("Asking Gemini...")
        response = ask_gemini(user_input, canvas_data)
        
        return jsonify({"response": response})
    except Exception as e:
        print(f"Error in chat: {str(e)}")
        return jsonify({"response": f"Sorry, I encountered an error: {str(e)}"})


# Default route to handle GET requests to the root URL
@app.route("/", methods=["GET"])
def home():
    return render_template("index.html")

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)