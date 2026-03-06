"""
字符串生成器 - Flask 后端
提供 Web 界面和 REST API
"""

from flask import Flask, render_template, request, jsonify, send_file
from generator import StringGenerator
from storage import StringStorage
from dotenv import load_dotenv
import io
import os
from pathlib import Path

# 加载环境变量
load_dotenv()

app = Flask(__name__)
app.json.ensure_ascii = False  # 支持中文 JSON

# 从环境变量读取配置
DEFAULT_PREFIX = os.getenv('STRING_PREFIX', 'custom-')
SERVER_HOST = os.getenv('SERVER_HOST', '127.0.0.1')
SERVER_PORT = int(os.getenv('SERVER_PORT', '5000'))
ENV_FILE_PATH = Path(__file__).with_name('.env')

# 初始化生成器和存储
generator = StringGenerator(prefix=DEFAULT_PREFIX)
storage = StringStorage()
app.config['ENV_FILE_PATH'] = ENV_FILE_PATH


def get_env_file_path():
    """获取配置文件路径，便于测试时覆盖。"""
    return Path(app.config.get('ENV_FILE_PATH', ENV_FILE_PATH))


def read_persisted_config():
    """读取 .env 中保存的配置，用于页面回显。"""
    persisted = {
        'prefix': DEFAULT_PREFIX,
        'host': SERVER_HOST,
        'port': SERVER_PORT
    }
    env_path = get_env_file_path()

    if not env_path.exists():
        return persisted

    with env_path.open('r', encoding='utf-8') as env_file:
        for line in env_file:
            line_stripped = line.strip()
            if not line_stripped or line_stripped.startswith('#') or '=' not in line_stripped:
                continue

            key, value = line_stripped.split('=', 1)
            key = key.strip()
            value = value.strip()

            if key == 'STRING_PREFIX':
                persisted['prefix'] = value
            elif key == 'SERVER_HOST':
                persisted['host'] = value
            elif key == 'SERVER_PORT':
                try:
                    persisted['port'] = int(value)
                except ValueError:
                    continue

    return persisted


def validate_prefix(prefix):
    """验证前缀配置。"""
    prefix = prefix.strip()
    if not prefix:
        raise ValueError('前缀不能为空')
    if any(c in prefix for c in '\r\n\0='):
        raise ValueError('前缀不能包含控制字符或等号')
    return prefix


def validate_host(host):
    """验证服务器地址配置。"""
    host = host.strip()
    if not host:
        raise ValueError('服务器地址不能为空')
    if any(c in host for c in '\r\n\0='):
        raise ValueError('服务器地址不能包含控制字符或等号')
    return host


def validate_port(port):
    """验证端口配置。"""
    if isinstance(port, bool) or not isinstance(port, int) or port < 1 or port > 65535:
        raise ValueError('端口必须在 1-65535 之间')
    return port


def persist_config(prefix=None, host=None, port=None):
    """将配置写回 .env 文件。"""
    updates = {}

    if prefix is not None:
        updates['STRING_PREFIX'] = prefix
    if host is not None:
        updates['SERVER_HOST'] = host
    if port is not None:
        updates['SERVER_PORT'] = str(port)

    if not updates:
        return

    env_path = get_env_file_path()
    env_lines = []

    if env_path.exists():
        with env_path.open('r', encoding='utf-8') as env_file:
            env_lines = env_file.readlines()

    updated_keys = set()
    for index, line in enumerate(env_lines):
        line_stripped = line.strip()
        if not line_stripped or line_stripped.startswith('#') or '=' not in line_stripped:
            continue

        key = line_stripped.split('=', 1)[0].strip()
        if key in updates:
            env_lines[index] = f'{key}={updates[key]}\n'
            updated_keys.add(key)

    for key, value in updates.items():
        if key not in updated_keys:
            env_lines.append(f'{key}={value}\n')

    env_path.parent.mkdir(parents=True, exist_ok=True)
    with env_path.open('w', encoding='utf-8') as env_file:
        env_file.writelines(env_lines)


def build_config_response():
    """构建当前配置响应。"""
    persisted = read_persisted_config()
    return {
        'prefix': generator.prefix,
        'saved_prefix': persisted['prefix'],
        'default_prefix': DEFAULT_PREFIX,
        'server_host': persisted['host'],
        'server_port': persisted['port']
    }


# ==================== Web 页面 ====================

@app.route('/')
def index():
    """主页面"""
    return render_template('index.html')


# ==================== API 接口 ====================

@app.route('/api/config', methods=['GET'])
def get_config():
    """获取当前配置"""
    return jsonify(build_config_response())


@app.route('/api/config/prefix', methods=['PATCH'])
def update_prefix():
    """实时更新前缀，并立即作用于后续生成。"""
    try:
        data = request.get_json(silent=True)
        if data is None:
            return jsonify({'error': '请求体格式错误'}), 400
        if 'prefix' not in data:
            return jsonify({'error': '缺少 prefix 字段'}), 400

        prefix = validate_prefix((data.get('prefix') or ''))

        persist_config(prefix=prefix)
        generator.prefix = prefix

        return jsonify({
            'message': '前缀已实时生效',
            'prefix': generator.prefix,
            'formats': generator.get_supported_formats(prefix=generator.prefix)
        })

    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': f'更新失败: {str(e)}'}), 500


@app.route('/api/config', methods=['POST'])
def update_config():
    """
    更新配置并保存到 .env 文件

    请求体:
    {
        "prefix": "new-prefix-",  // 可选
        "host": "127.0.0.1",      // 可选
        "port": 5000              // 可选
    }
    """
    try:
        data = request.get_json(silent=True)
        if data is None:
            return jsonify({'error': '请求体格式错误'}), 400

        prefix = validate_prefix((data.get('prefix') or '')) if 'prefix' in data else None
        host = validate_host((data.get('host') or '')) if 'host' in data else None
        port = data.get('port') if 'port' in data else None

        # 至少要更新一个字段
        if prefix is None and host is None and port is None:
            return jsonify({'error': '至少需要提供一个配置项'}), 400

        # 验证端口
        if port is not None:
            port = validate_port(port)

        persist_config(prefix=prefix, host=host, port=port)

        # 前缀立即生效，端口和地址需要重启
        if prefix is not None:
            generator.prefix = prefix

        message = '配置已保存'
        if host is not None or port is not None:
            message += '，端口和地址修改需要重启服务才能生效'
        if prefix is not None:
            message += '，前缀已立即生效'

        return jsonify({
            'message': message,
            'updated': {
                'prefix': prefix,
                'host': host,
                'port': port
            },
            'config': build_config_response(),
            'formats': generator.get_supported_formats(prefix=generator.prefix)
        })

    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': f'更新失败: {str(e)}'}), 500


@app.route('/api/formats', methods=['GET'])
def get_formats():
    """获取支持的所有格式"""
    return jsonify(generator.get_supported_formats(prefix=generator.prefix))


@app.route('/api/generate', methods=['POST'])
def generate_string():
    """
    生成随机字符串

    请求体:
    {
        "format": "uuid_hex",  // 格式类型
        "length": 32           // 长度（可选）
    }
    """
    try:
        data = request.get_json(silent=True)
        if data is None:
            return jsonify({'error': '请求体格式错误'}), 400

        format_type = data.get('format', 'uuid_hex')
        length = data.get('length', 32)

        # 获取格式信息
        formats = generator.get_supported_formats(prefix=generator.prefix)
        format_info = formats.get(format_type)

        if not format_info:
            return jsonify({'error': f'不支持的格式: {format_type}'}), 400

        # 对于不支持长度的格式，忽略长度参数
        if not format_info['supports_length']:
            length = None
        else:
            # 验证长度
            if not isinstance(length, int) or length < 1 or length > 256:
                return jsonify({'error': '长度必须在 1-256 之间'}), 400

        value = generator.generate(format_type, length or 32)

        return jsonify({
            'value': value,
            'format': format_type,
            'length': length  # 对于不支持长度的格式，返回 None
        })

    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': f'生成失败: {str(e)}'}), 500


@app.route('/api/entries', methods=['GET'])
def get_entries():
    """
    获取所有保存的字符串

    查询参数:
    - search: 搜索关键词（可选）
    """
    try:
        search = request.args.get('search', '').strip()
        entries = storage.get_all(search if search else None)

        return jsonify({
            'entries': entries,
            'total': len(entries)
        })

    except Exception as e:
        return jsonify({'error': f'查询失败: {str(e)}'}), 500


@app.route('/api/entries', methods=['POST'])
def save_entry():
    """
    保存字符串

    请求体:
    {
        "name": "my_key",           // 自定义名称（必填）
        "value": "custom-abc123",   // 字符串值（必填）
        "format": "hex",            // 格式类型（必填）
        "length": 32,               // 长度（可选）
        "enforce_prefix": true      // 是否自动补当前前缀（可选）
    }
    """
    try:
        data = request.get_json(silent=True)
        if data is None:
            return jsonify({'error': '请求体格式错误'}), 400

        name = (data.get('name') or '').strip()
        value = (data.get('value') or '').strip()
        format_type = (data.get('format') or '').strip()
        length = data.get('length')
        enforce_prefix = data.get('enforce_prefix', True)

        # 验证必填字段
        if not name:
            return jsonify({'error': '名称不能为空'}), 400
        if not value:
            return jsonify({'error': '值不能为空'}), 400
        if not format_type:
            return jsonify({'error': '格式类型不能为空'}), 400
        if not isinstance(enforce_prefix, bool):
            return jsonify({'error': 'enforce_prefix 必须是布尔值'}), 400

        # 验证格式类型是否支持
        formats = generator.get_supported_formats(prefix=generator.prefix)
        format_info = formats.get(format_type)
        if not format_info:
            return jsonify({'error': f'不支持的格式: {format_type}'}), 400

        # 手动输入时才自动补当前前缀，已生成/已存在的值允许原样保存
        if enforce_prefix and not value.startswith(generator.prefix):
            value = generator.prefix + value

        # 对于不支持长度的格式，忽略长度参数
        if not format_info['supports_length']:
            length = None

        # 保存到数据库
        entry = storage.save(name, value, format_type, length)

        return jsonify({
            'message': '保存成功',
            'entry': entry
        }), 201

    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': f'保存失败: {str(e)}'}), 500


@app.route('/api/entries/<int:entry_id>', methods=['GET'])
def get_entry(entry_id):
    """获取单个记录"""
    try:
        entry = storage.get_by_id(entry_id)

        if not entry:
            return jsonify({'error': '记录不存在'}), 404

        return jsonify(entry)

    except Exception as e:
        return jsonify({'error': f'查询失败: {str(e)}'}), 500


@app.route('/api/entries/<int:entry_id>', methods=['PATCH'])
def update_entry(entry_id):
    """
    更新记录

    请求体:
    {
        "name": "new_name",         // 新名称（可选）
        "value": "new_value",       // 新值（可选）
        "enforce_prefix": true      // 是否自动补当前前缀（可选）
    }
    """
    try:
        data = request.get_json(silent=True)
        if data is None:
            return jsonify({'error': '请求体格式错误'}), 400

        name = (data.get('name') or '').strip() if 'name' in data else None
        value = (data.get('value') or '').strip() if 'value' in data else None
        enforce_prefix = data.get('enforce_prefix', True)

        # 至少要更新一个字段
        if name is None and value is None:
            return jsonify({'error': '至少需要提供一个更新字段'}), 400
        if not isinstance(enforce_prefix, bool):
            return jsonify({'error': 'enforce_prefix 必须是布尔值'}), 400

        # 编辑已有值时允许原样保存，仅在显式要求时补当前前缀
        if value is not None and enforce_prefix and not value.startswith(generator.prefix):
            value = generator.prefix + value

        # 更新记录
        success = storage.update(entry_id, name, value)

        if not success:
            return jsonify({'error': '记录不存在'}), 404

        # 返回更新后的记录
        entry = storage.get_by_id(entry_id)
        return jsonify({
            'message': '更新成功',
            'entry': entry
        })

    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': f'更新失败: {str(e)}'}), 500


@app.route('/api/entries/<int:entry_id>', methods=['DELETE'])
def delete_entry(entry_id):
    """删除记录"""
    try:
        success = storage.delete(entry_id)

        if not success:
            return jsonify({'error': '记录不存在'}), 404

        return jsonify({'message': '删除成功'})

    except Exception as e:
        return jsonify({'error': f'删除失败: {str(e)}'}), 500


@app.route('/api/export', methods=['GET'])
def export_entries():
    """导出所有记录为 JSON 文件"""
    try:
        json_data = storage.export_json()

        # 创建文件流
        buffer = io.BytesIO(json_data.encode('utf-8'))
        buffer.seek(0)

        return send_file(
            buffer,
            mimetype='application/json',
            as_attachment=True,
            download_name='strings-export.json'
        )

    except Exception as e:
        return jsonify({'error': f'导出失败: {str(e)}'}), 500


@app.route('/api/statistics', methods=['GET'])
def get_statistics():
    """获取统计信息"""
    try:
        stats = storage.get_statistics()
        return jsonify(stats)

    except Exception as e:
        return jsonify({'error': f'查询失败: {str(e)}'}), 500


# ==================== 错误处理 ====================

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': '接口不存在'}), 404


@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': '服务器内部错误'}), 500


# ==================== 启动服务 ====================

if __name__ == '__main__':
    print("=" * 50)
    print("🚀 字符串生成器启动中...")
    print(f"📍 访问地址: http://{SERVER_HOST}:{SERVER_PORT}")
    print(f"🔧 字符串前缀: {generator.prefix}")
    print("=" * 50)

    # 通过环境变量控制 debug 模式
    debug_mode = os.getenv('FLASK_DEBUG', 'false').lower() == 'true'
    app.run(host=SERVER_HOST, port=SERVER_PORT, debug=debug_mode)
