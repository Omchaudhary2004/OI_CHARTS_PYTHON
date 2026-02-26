# routes/__init__.py
# Registers all route Blueprints onto the Flask app.

from .process           import bp as process_bp
from .indicators        import bp as indicators_bp
from .custom_indicators import bp as custom_indicators_bp
from .connect           import bp as connect_bp
from .logs              import bp as logs_bp


def register_routes(app):
    app.register_blueprint(process_bp)
    app.register_blueprint(indicators_bp)
    app.register_blueprint(custom_indicators_bp)
    app.register_blueprint(connect_bp)
    app.register_blueprint(logs_bp)
